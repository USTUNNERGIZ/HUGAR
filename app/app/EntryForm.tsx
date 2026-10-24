'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import './hugar-compact.css';

type Group = { id: number; name: string };
type Account = { id: number; group_id: number; name: string; account_type: string; opening_date: string };
type Mode = 'income' | 'expense';
type Channel = 'cash' | 'pos' | 'other';
type Props = { groups: Group[]; accounts: Account[]; fixedGroupId: number; mode: Mode; onSaved: () => void };

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const money = (n: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n);
const expenseCategories = ['Tedarikçi / Mal Alımı', 'Kira', 'Personel', 'Elektrik / Su / Doğalgaz', 'Vergi / SGK', 'Bakım / Onarım', 'Diğer'];

export default function EntryForm({ groups, accounts, fixedGroupId, mode, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>('cash');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(expenseCategories[0]);
  const [categories,setCategories]=useState<string[]>(expenseCategories);
  const [newCategory,setNewCategory]=useState('');
  const [addingCategory,setAddingCategory]=useState(false);
  const [addingAccount,setAddingAccount]=useState(false);
  const [newAccountName,setNewAccountName]=useState('');
  const [newAccountType,setNewAccountType]=useState('cash');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(()=>{const db=getSupabase();if(db)void db.rpc('hugar_categories_read',{p_group_id:fixedGroupId}).then(({data,error})=>{if(!error&&Array.isArray(data))setCategories([...new Set([...expenseCategories,...data.map(String)])]);});},[fixedGroupId]);
  async function createCategory(){const db=getSupabase();if(!db||!newCategory.trim())return;const {error}=await db.rpc('hugar_categories_add',{p_group_id:fixedGroupId,p_name:newCategory.trim()});if(error){setMessage(error.message);return;}setCategories(v=>[...new Set([...v,newCategory.trim()])]);setCategory(newCategory.trim());setNewCategory('');setAddingCategory(false);}
  async function createAccount(){const db=getSupabase();if(!db||!newAccountName.trim())return;const {error}=await db.rpc('hugar_finance_account_add',{p_group_id:fixedGroupId,p_name:newAccountName.trim(),p_type:newAccountType});if(error){setMessage(error.message);return;}window.location.reload();}
  const group = groups.find(g => g.id === fixedGroupId);
  const available = useMemo(() => accounts.filter(a => a.group_id === fixedGroupId && (
    mode === 'expense' || channel === 'other' || (channel === 'cash' ? a.account_type === 'cash' : a.account_type === 'bank')
  )), [accounts, fixedGroupId, mode, channel]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setMessage('');
    const db = getSupabase();
    if (!db) { setMessage('Veritabanı bağlantısı bulunamadı.'); return; }
    const numeric = Number(amount.replace(',', '.'));
    const account = available.find(a => String(a.id) === accountId);
    const memo = mode === 'expense' ? `${category} — ${description.trim()}` : description.trim();
    if (!group || !account || !date || !description.trim() || memo.length > 500 || !Number.isFinite(numeric) || numeric <= 0 || numeric > 999999999999 || Math.abs(Math.round(numeric * 100) - numeric * 100) > 0.000001) {
      setMessage('Hesap, tarih, açıklama ve en fazla iki ondalıklı pozitif tutar girin.'); return;
    }
    if (date < account.opening_date) { setMessage('Tarih, hesabın açılış tarihinden önce olamaz.'); return; }
    if (!window.confirm(`${group.name}\n${mode === 'income' ? `GELİR · ${channel === 'cash' ? 'NAKİT' : channel === 'pos' ? 'POS' : 'DİĞER'}` : 'GİDER'}\n${money(numeric)}\n${memo}\n\nBu kayıt oluşturulsun mu?`)) return;
    setBusy(true);
    try {
      const { error } = await db.rpc('finance_record_entry', {
        p_group_id: fixedGroupId, p_account_id: account.id, p_document_type: mode,
        p_description: memo, p_amount: numeric, p_date: date,
        p_request_id: crypto.randomUUID(), p_income_channel: mode === 'income' ? channel : null
      });
      if (error) throw error;
      setAmount(''); setDescription(''); setAccountId(''); setOpen(false);
      setMessage('Kayıt başarıyla oluşturuldu.'); onSaved();
    } catch (e) {
      setMessage('Kayıt oluşturulamadı: ' + (e instanceof Error ? e.message : 'Bilinmeyen hata'));
    } finally { setBusy(false); }
  }

  return <section className="hugar-entry">
    <div className="hugar-entry-top">
      <div>
        <span className="hugar-entry-eyebrow">{group?.name ?? 'İşletme'} · İŞLEM YÖNETİMİ</span>
        <h2>{mode === 'income' ? 'Gelirler' : 'Giderler'}</h2>
        <p>{mode === 'income' ? 'Nakit, POS ve diğer tahsilatları ayrı kaydedin.' : 'İşletmenizin harcamalarını kategorilere göre kaydedin.'}</p>
      </div>
      <button type="button" className="hugar-primary" onClick={() => { setOpen(v => !v); setMessage(''); }}>{open ? 'Formu Kapat' : mode === 'income' ? '+ Gelir Ekle' : '+ Gider Ekle'}</button>
    </div>
    {message && <p className="hugar-form-message" role="status">{message}</p>}
    {open && <form className="hugar-entry-form" onSubmit={save}>
      {mode === 'income' && <div className="hugar-field hugar-wide"><span className="hugar-field-title">Gelir türü</span><div className="hugar-channel-grid" role="group" aria-label="Gelir türü">
        {([['cash','Nakit','Kasa tahsilatı'],['pos','POS','Kart tahsilatı'],['other','Diğer','Havale / EFT']] as const).map(([value,title,detail]) =>
          <button key={value} type="button" className={`hugar-channel ${channel === value ? 'is-active' : ''}`} aria-pressed={channel === value} onClick={() => { setChannel(value); setAccountId(''); }}><strong>{title}</strong><small>{detail}</small></button>)}
      </div></div>}
      {mode === 'expense' && <div className="hugar-field">Gider kategorisi<div className="hugar-compact-select"><select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select><button type="button" className="hugar-add-mini" onClick={()=>setAddingCategory(true)}>+ Yeni</button></div></div>}
      <div className="hugar-field">{mode === 'income' ? 'Tahsilat hesabı' : 'Ödeme hesabı'}<div className="hugar-compact-select"><select required value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Hesap seçin</option>{available.map(a => <option key={a.id} value={a.id}>{a.name} ({a.account_type})</option>)}</select><button type="button" className="hugar-add-mini" onClick={()=>setAddingAccount(true)}>+ Yeni</button></div></div>
      <label className="hugar-field">İşlem tarihi<input required type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="hugar-field">Tutar (TL)<input required inputMode="decimal" placeholder="Örn. 1.250,50" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="hugar-field hugar-wide">Açıklama<input required maxLength={mode === 'expense' ? 465 : 500} placeholder={mode === 'income' ? 'Örn. Günlük satış' : 'Örn. Ekim ayı elektrik faturası'} value={description} onChange={e => setDescription(e.target.value)} /></label>
      {available.length === 0 && <p className="hugar-form-message hugar-wide">Uygun hesap bulunamadı. Önce bu işletmeye ait {mode === 'income' && channel === 'cash' ? 'kasa' : mode === 'income' && channel === 'pos' ? 'banka' : 'kasa veya banka'} hesabı oluşturulmalı.</p>}
      <div className="hugar-form-actions hugar-wide"><button className="hugar-primary" type="submit" disabled={busy || !available.length}>{busy ? 'Kaydediliyor…' : mode === 'income' ? 'Geliri Kaydet' : 'Gideri Kaydet'}</button><button type="button" className="hugar-secondary" onClick={() => setOpen(false)}>Vazgeç</button></div>
      <p className="hugar-form-footnote hugar-wide">Kayıt, seçilen işletmeye ait belge ve hesap hareketi oluşturur. POS için banka, nakit için kasa hesabı gerekir. POS tutarlarının banka hesabına işlenmesi, fiili ödeme aktarımını ayrıca izlemez.</p>
    </form>}
    {(addingCategory||addingAccount)&&<div className="hugar-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget){setAddingCategory(false);setAddingAccount(false);}}}><div className="hugar-modal" role="dialog" aria-modal="true" aria-label={addingCategory?'Yeni kategori':'Yeni hesap'}><div className="hugar-modal-head"><h3>{addingCategory?'Yeni Gider Kategorisi':'Yeni Kasa / Banka Hesabı'}</h3><button type="button" className="hugar-modal-close" onClick={()=>{setAddingCategory(false);setAddingAccount(false);}}>×</button></div>{addingCategory?<label>Kategori adı<input autoFocus value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="Örn. Temizlik"/></label>:<><label>Hesap adı<input autoFocus value={newAccountName} onChange={e=>setNewAccountName(e.target.value)} placeholder="Örn. İş Bankası"/></label><label>Hesap türü<select value={newAccountType} onChange={e=>setNewAccountType(e.target.value)}><option value="cash">Kasa</option><option value="bank">Banka</option></select></label></>}<div className="hugar-modal-actions"><button type="button" onClick={()=>{setAddingCategory(false);setAddingAccount(false);}}>Vazgeç</button><button type="button" onClick={()=>void(addingCategory?createCategory():createAccount())}>Kaydet</button></div></div></div>}
  </section>;
}
