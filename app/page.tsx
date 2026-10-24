
'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import PinGate, { hasPin } from './PinGate';
import EntryForm from './EntryForm';
import MarketCari from './MarketCari';
import './hugar-dashboard.css';
import './hugar-dashboard-extra.css';
import type { User } from '@supabase/supabase-js';

const db = getSupabase();

type Group = { id: number; name: string; sort_order: number };
type Account = {
  id: number; group_id: number; name: string;
  account_type: string; opening_balance: number; opening_date: string;
};
type Movement = {
  id: number; group_id: number; account_id: number;
  direction: string; amount: number; movement_date: string;
};
type Document = {
  id: number; group_id: number; document_type: string;
  description: string; amount: number; due_date: string | null;
};

const fmt = (n: number) =>
  new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY'
  }).format(n);

const safeName = (v: string) =>
  /^[a-z0-9][a-z0-9._-]{2,31}$/.test(v);

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin'|'employee'|'unknown'|'loading'>('loading');
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketStats,setMarketStats]=useState<{open_debt:number;net_debt:number;advance:number;invoices:number;payments:number;cash_balance:number;card_debt:number;accounts_count:number}|null>(null);
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [display, setDisplay] = useState('');
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [pinLocked, setPinLocked] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [section, setSection] = useState<'income' | 'expense'>('income');

  useEffect(() => {
    if (!db) {
      setReady(true);
      return;
    }

    db.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setPinLocked(!!data.user && hasPin(data.user.id));
      setReady(true);
    });

    const { data } = db.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'SIGNED_IN') setPinLocked(false);
      if (event === 'SIGNED_OUT') { setPinLocked(false); setShowPinSetup(false); }
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!db || !user || role !== 'admin') return;
    let live = true;

    (async () => {
      const [g, a, m, d, p] = await Promise.all([
        db.from('finance_groups')
          .select('id,name,sort_order').order('sort_order'),
        db.from('finance_accounts')
          .select('id,group_id,name,account_type,opening_balance,opening_date'),
        db.from('finance_movements')
          .select('id,group_id,account_id,direction,amount,movement_date'),
        db.from('finance_documents')
          .select('id,group_id,document_type,description,amount,due_date'),
        db.from('finance_user_roles')
          .select('display_name,username')
          .eq('user_id', user.id).maybeSingle()
      ]);

      if (!live) return;

      const err = [g, a, m, d, p].find(x => x.error)?.error;
      if (err) setError(err.message);

      setGroups(g.data || []);
      setAccounts(a.data || []);
      setMovements(m.data || []);
      setDocuments(d.data || []);
      setDisplay(p.data?.display_name || p.data?.username || 'Kullanıcı');
      const {data:marketResult,error:marketError}=await db.rpc('hugar_market_summary_v3');
      if(live){if(marketError)setError('Cari özet okunamadı: '+marketError.message);else setMarketStats(marketResult as typeof marketStats);}
    })();

    return () => { live = false; };
  }, [user, refreshKey, role]);

  useEffect(() => {
    if (!db || !user) { setRole('loading'); return; }
    let active = true;
    db.from('finance_user_roles').select('role').eq('user_id',user.id).maybeSingle().then(({data,error}) => {
      if(active) setRole(!error && data?.role === 'admin' ? 'admin' : !error && data?.role === 'employee' ? 'employee' : 'unknown');
    });
    return () => {active=false;};
  }, [user]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (!db) return;

    const name = username.trim().toLowerCase();

    if (!name.includes('@') && !safeName(name)) {
      setError('Kullanıcı adı geçersiz.');
      return;
    }

    setBusy(true);
    setError('');

    // Mevcut yönetici hesabının kullanıcı adı eşleştirmesi.
    // Diğer çalışanların giriş sistemi ayrıca yapılandırılmalıdır.
    const email = name === 'sabri'
      ? 'beyogluhugar@hotmail.com'
      : name === 'iso' ? 'isokaplan34@gmail.com'
      : name.includes('@')
        ? name
        : `${name}@staff.invalid`;

    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) setError('Kullanıcı adı veya şifre hatalı.');
    setBusy(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!db || !user || passwordBusy) return;

    setPasswordMessage('');

    if (newPassword.length < 12) {
      setPasswordMessage('Yeni şifre en az 12 karakter olmalıdır.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage('Şifreler birbiriyle eşleşmiyor.');
      return;
    }

    setPasswordBusy(true);

    const { error } = await db.auth.updateUser({
      password: newPassword
    });

    setPasswordBusy(false);

    if (error) {
      setPasswordMessage('Şifre değiştirilemedi: ' + error.message);
      return;
    }

    setNewPassword('');
    setConfirmPassword('');
    setShowPasswordChange(false);
    window.alert('Şifreniz başarıyla değiştirildi.');
  }

  if (!ready) return <main className="center">Yükleniyor…</main>;

  if (!db) return (
    <main className="center">
      <div className="login">
        <h1>Finans Yönetim Merkezi</h1>
        <p>.env.local dosyasındaki Supabase bağlantısını kontrol edin.</p>
      </div>
    </main>
  );

  if (!user) return (
    <main className="center">
      <form className="login" onSubmit={login}>
        <div className="mark">₺</div>
        <h1>Finans Yönetim Merkezi</h1>
        <p>Dört grubunuz, tek güvenli panel.</p>
        <label>
          Kullanıcı adı
          <input required autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="ör. sabri" />
        </label>
        <label>
          Şifre
          <input required type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>
          {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
        <small>Çalışan hesabı yönetici tarafından oluşturulur.</small>
      </form>
    </main>
  );

  if (pinLocked) return <PinGate mode="unlock" userId={user.id}
    onDone={() => setPinLocked(false)}
    onCancel={() => { void db.auth.signOut(); }} />;

  if (role === 'loading') return <main className="center">Yetkiler kontrol ediliyor…</main>;
  if (role === 'unknown') return <main className="center"><div className="login"><h2>Yetkisiz hesap</h2><button onClick={()=>void db.auth.signOut()}>Çıkış</button></div></main>;
  if (role === 'employee') return <main style={{minHeight:'100vh',background:'#180f18',color:'#fff',padding:'22px'}}><div style={{maxWidth:1100,margin:'auto'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><strong>HUGAR · Beyoğlu Mini Market</strong><button onClick={()=>void db.auth.signOut()}>Çıkış Yap</button></div><MarketCari admin={false}/></div></main>;

  const businessGroups = groups.filter(g => {
    const n = g.name.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9ğüşöçı]/g, '');
    return n.includes('beyoğlu') || n.includes('beyoglu') || n.includes('hugar') || n.includes('crown') || n.includes('otel') || n.includes('hotel');
  });
  const selected = active === null ? businessGroups : groups.filter(g => g.id === active);
  const activeGroup = groups.find(g => g.id === active);
  const isBusiness = !!activeGroup && businessGroups.some(g => g.id === activeGroup.id);
  const selectedIds = new Set(selected.map(g => g.id));
  const marketGroup = businessGroups.find(g => /beyoğlu|beyoglu/i.test(g.name));
  const marketGroupId = marketGroup?.id ?? 1;
  const marketPayments = Number(marketStats?.payments ?? 0);
  const docIncome = (groupId:number) => documents.filter(d => d.group_id === groupId && d.document_type === 'income').reduce((s,d)=>s+Number(d.amount),0);
  const docExpense = (groupId:number) => documents.filter(d => d.group_id === groupId && d.document_type === 'expense').reduce((s,d)=>s+Number(d.amount),0);
  const incomeTotal = selected.reduce((s,g)=>s+docIncome(g.id),0);
  // Genel Bakış'ta Ev gideri de dahil; Ev geliri dahil değildir.
  const homeGroups = groups.filter(g => !businessGroups.some(b => b.id === g.id));
  const homeExpense = active === null ? homeGroups.reduce((s,g)=>s+docExpense(g.id),0) : 0;
  const expenseTotal = selected.reduce((s,g)=>s+docExpense(g.id),0)
    + (active === null || active === marketGroupId ? marketPayments : 0) + homeExpense;
  const incomeByGroup = businessGroups.map(g=>({name:g.name,value:docIncome(g.id)}));
  const expenseByGroup = [...businessGroups.map(g=>({name:g.name,value:docExpense(g.id)+(g.id===marketGroupId?marketPayments:0)})),
    {name:'Ev',value:homeGroups.reduce((s,g)=>s+docExpense(g.id),0)}];
  const chartColors=['#78d8ac','#d78098','#bba4ef','#e3b67b'];
  const donutStyle=(items:{value:number}[])=>{
    const sum=items.reduce((s,x)=>s+x.value,0);
    if(sum<=0)return {background:'#3b3541'};
    let offset=0;
    const stops=items.map((item,i)=>{const from=offset;offset+=Math.max(0,item.value)/sum*100;return `${chartColors[i%chartColors.length]} ${from}% ${offset}%`;});
    return {background:`conic-gradient(${stops.join(',')})`};
  };

  const balances = accounts.map(a => ({
    ...a,
    balance: Number(a.opening_balance) +
      movements
        .filter(m => m.account_id === a.id && m.movement_date >= a.opening_date)
        .reduce((s, m) =>
          s + (m.direction === 'in' ? 1 : -1) * Number(m.amount), 0)
  }));

  const total = balances
    .filter(a => selected.some(g => g.id === a.group_id) &&
      a.account_type !== 'credit_card')
    .reduce((s, a) => s + a.balance, 0);

  const debt = documents
    .filter(d => selected.some(g => g.id === d.group_id) &&
      d.document_type === 'expense')
    .reduce((s, d) => s + Number(d.amount), 0);

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="mark">₺</span>
          <div>
            <strong>Finans Merkezi</strong>
            <small>Gece / Bordo</small>
          </div>
        </div>

        <h3>Finans grupları</h3>
        <button className={active === null ? 'selected' : ''}
          onClick={() => setActive(null)}>Genel görünüm</button>

        {groups.map(g => (
          <button key={g.id}
            className={active === g.id ? 'selected' : ''}
            onClick={() => setActive(g.id)}>{g.name}</button>
        ))}
<div className="user">
          <div>{display}</div>
          <button type="button" onClick={() => setShowPinSetup(true)}>
            {hasPin(user.id) ? 'PIN Değiştir' : '4 Haneli PIN Ayarla'}
          </button>
          {hasPin(user.id) && <button type="button" onClick={() => setPinLocked(true)}>
            Ekranı Kilitle
          </button>}
          <button type="button"
            onClick={() => {
              setPasswordMessage('');
              setShowPasswordChange(true);
            }}>
            Şifre Değiştir
          </button>
          <button type="button" onClick={() => db.auth.signOut()}>
            Çıkış yap
          </button>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <p className="eyebrow">FİNANS YÖNETİM MERKEZİ</p>
            <h1>{active === null ? 'Genel Bakış' :
              groups.find(g => g.id === active)?.name}</h1>
            <p className="muted">{active === null ? 'Beyoğlu Mini Market · Hugar Gıda · Taksim Crown Hotel' : isBusiness ? 'İşletmeye özel gelir, gider ve hesap takibi' : 'Ev finansları için ayrı bölüm hazırlanacak'}</p>
          </div>
          <span className="tag">HUGAR · İşletme Finansları</span>
        </header>

        {error && <div className="error">{error}</div>}

        {showPinSetup && <PinGate mode="setup" userId={user.id}
          onDone={() => setShowPinSetup(false)}
          onCancel={() => setShowPinSetup(false)} />}

        {isBusiness && <div className="hugar-tabs" role="tablist" aria-label="İşletme işlemleri">
          <button type="button" role="tab" aria-selected={section === 'income'} className={section === 'income' ? 'current' : ''} onClick={() => setSection('income')}>↙ Gelirler</button>
          <button type="button" role="tab" aria-selected={section === 'expense'} className={section === 'expense' ? 'current' : ''} onClick={() => setSection('expense')}>↗ Giderler</button>
          {active === marketGroupId && <button type="button" role="tab" aria-selected={marketOpen} className={marketOpen ? 'current' : ''} onClick={() => setMarketOpen(v => !v)}>▣ Cari Hesaplar · Faturalar · Ödemeler</button>}
        </div>}
        {active === marketGroupId && marketOpen && <MarketCari admin={true} onChanged={()=>setRefreshKey(v=>v+1)}/>}
        {isBusiness && !(active === marketGroupId && marketOpen) && <EntryForm key={`${active}-${section}`} groups={businessGroups} accounts={accounts}
          fixedGroupId={active!} mode={section}
          onSaved={() => { setError(''); setRefreshKey(v => v + 1); }} />}
        {active !== null && !isBusiness && <section className="panel"><h2>Ev Finansları</h2><p className="muted">Ev için gelir ve gider sekmelerini ayrı hazırlayacağız. İşletme kayıtlarıyla karışmaz.</p></section>}

        {showPasswordChange && (
          <section className="panel" style={{ maxWidth: 480 }}>
            <h2>Şifre Değiştir</h2>
            <form onSubmit={changePassword}
              style={{ display: 'grid', gap: 14, marginTop: 18 }}>
              <label>
                Yeni şifre
                <input type="password" required minLength={12}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: 8 }} />
              </label>
              <label>
                Yeni şifre tekrar
                <input type="password" required minLength={12}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: 8 }} />
              </label>
              {passwordMessage && <div className="error">{passwordMessage}</div>}
              <button type="submit" disabled={passwordBusy}
                style={{ background: '#72263f', color: 'white',
                  padding: 12, borderRadius: 9 }}>
                {passwordBusy ? 'Kaydediliyor…' : 'Yeni Şifreyi Kaydet'}
              </button>
              <button type="button" onClick={() => {
                setShowPasswordChange(false);
                setNewPassword('');
                setConfirmPassword('');
                setPasswordMessage('');
              }}>İptal</button>
            </form>
          </section>
        )}
        {active === null && <section className="hugar-overview">
          <div className="hugar-kpis">
            <article className="hugar-kpi"><span>TOPLAM GELİR</span><strong className="positive">{fmt(incomeTotal)}</strong><small>3 işletmenin kayıtlı gelirleri</small></article>
            <article className="hugar-kpi"><span>TOPLAM GİDER</span><strong className="negative">{fmt(expenseTotal)}</strong><small>İşletmeler + Ev + Market cari ödemeleri</small></article>
            <article className="hugar-kpi"><span>NET SONUÇ</span><strong>{fmt(incomeTotal - expenseTotal)}</strong><small>Gelir − gider</small></article>
          </div>
          <div className="hugar-chart-grid">
            {[{title:'Gelir dağılımı',items:incomeByGroup,total:incomeTotal},{title:'Gider dağılımı',items:expenseByGroup,total:expenseTotal}].map(chart=>(
              <section className="hugar-chart-panel" key={chart.title}>
                <h2>{chart.title}</h2>
                <p className="muted">{chart.title.startsWith('Gelir')?'Üç işletmenin gelirleri':'Üç işletme, Market cari ödemeleri ve Ev giderleri'}</p>
                <div className="hugar-donut" role="img" aria-label={`${chart.title}: ${fmt(chart.total)}`} style={donutStyle(chart.items)}>
                  <div className="hugar-donut-hole"><span>TOPLAM</span><strong>{fmt(chart.total)}</strong></div>
                </div>
                <div className="hugar-chart-legend">{chart.items.map((item,i)=><div key={item.name}><i style={{background:chartColors[i%chartColors.length]}}/><span>{item.name}</span><strong>{fmt(item.value)}</strong></div>)}</div>
              </section>
            ))}
          </div>
          <div className="hugar-business-grid">{businessGroups.map(g => {
            const inc = documents.filter(d => d.group_id === g.id && d.document_type === 'income').reduce((v,d) => v + Number(d.amount),0);
            const exp = docExpense(g.id) + (g.id === marketGroupId ? marketPayments : 0);
            return <button type="button" className="hugar-business-card" key={g.id} onClick={() => setActive(g.id)}><span>{g.name}</span><strong>{fmt(inc-exp)}</strong><small>Gelir {fmt(inc)} · Gider {fmt(exp)}</small><em>İşletmeyi aç →</em></button>;
          })}</div>
          {businessGroups.length !== 3 && <p className="muted">Not: Sistem işletme adlarına göre {businessGroups.length} grup eşleştirdi. Üç işletme görünmüyorsa grup adlarını kontrol edelim.</p>}
        </section>}
        {active===marketGroupId && !marketOpen && section==='expense' && marketPayments>0 && <section className="panel" style={{marginBottom:20}}><h2>Market Cari · Gerçekleşen Ödemeler</h2><p className="muted">Cari ekranında kaydedilen ve iptal edilmemiş ödemeler gider toplamına otomatik dahildir. Tekrar gider eklemeyin.</p><strong style={{fontSize:26}}>{fmt(marketPayments)}</strong></section>}
        {isBusiness && !(active===marketGroupId&&marketOpen) && <section className="hugar-kpis" style={{marginBottom:22}}>
          <article className="hugar-kpi"><span>TOPLAM GELİR</span><strong className="positive">{fmt(incomeTotal)}</strong></article>
          <article className="hugar-kpi"><span>TOPLAM GİDER</span><strong className="negative">{fmt(expenseTotal)}</strong></article>
          <article className="hugar-kpi"><span>NET SONUÇ</span><strong>{fmt(incomeTotal-expenseTotal)}</strong></article>
        </section>}
        {active !== null && !(active===marketGroupId&&marketOpen) && <section className="cards"><article><small>Nakit + banka bakiyesi</small><strong>{fmt(total)}</strong><span>Hesap hareketlerinden</span></article><article><small>Hesap sayısı</small><strong>{balances.filter(a => selectedIds.has(a.group_id)).length}</strong><span>Seçili grup</span></article><article><small>Kaydedilen gider belgeleri</small><strong>{fmt(debt)}</strong><span>Borç bakiyesi değildir</span></article></section>}

        <section className="panel">
          <h2>Hesaplar</h2>
          {balances.filter(a =>
            selected.some(g => g.id === a.group_id)).length === 0
            ? <p className="muted">Henüz hesap oluşturulmadı. Gerçek kayıt
              girmeden önce yetki ve işlem kontrollerini tamamlayacağız.</p>
            : <div className="table">
              <table>
                <thead><tr><th>Grup</th><th>Hesap</th><th>Tür</th>
                  <th>Hesaplanan bakiye</th></tr></thead>
                <tbody>
                  {balances.filter(a =>
                    selected.some(g => g.id === a.group_id)).map(a => (
                    <tr key={a.id}>
                      <td>{groups.find(g => g.id === a.group_id)?.name}</td>
                      <td>{a.name}</td>
                      <td>{a.account_type}</td>
                      <td>{fmt(a.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        </section>

        <section className="panel">
          <h2>Son belgeler</h2>
          {documents.filter(d =>
            selected.some(g => g.id === d.group_id)).length === 0
            ? <p className="muted">Henüz fatura veya gelir belgesi yok.</p>
            : <div className="table">
              <table>
                <thead><tr><th>Açıklama</th><th>Tür</th><th>Tutar</th>
                  <th>Vade</th></tr></thead>
                <tbody>
                  {documents.filter(d =>
                    selected.some(g => g.id === d.group_id))
                    .slice(0, 20).map(d => (
                    <tr key={d.id}>
                      <td>{d.description}</td>
                      <td>{d.document_type}</td>
                      <td>{fmt(Number(d.amount))}</td>
                      <td>{d.due_date || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        </section>

        <p className="muted foot">
          Gelir ve giderler işletme bazında ayrı kaydedilir. Ev genel işletme özetine dahil değildir. Transfer, düzenleme ve silme henüz aktif değildir.
        </p>
      </main>
    </div>
  );
}