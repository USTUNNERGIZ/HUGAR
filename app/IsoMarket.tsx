'use client';
import {useEffect,useState} from 'react';
import {getSupabase} from '../lib/supabase';
import EntryForm from './EntryForm';
import MarketCari from './MarketCari';

type Account={id:number;group_id:number;name:string;account_type:string;opening_date:string};
type Expense={id:number;description:string;amount:number;document_date:string};
const money=(n:number)=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(n);
export default function IsoMarket({onLogout}:{onLogout:()=>void}){
 const [tab,setTab]=useState<'expense'|'cari'>('expense');
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [expenses,setExpenses]=useState<Expense[]>([]);
 const [groupId,setGroupId]=useState<number|null>(null);
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{let alive=true;const db=getSupabase();if(!db)return;
  void db.rpc('kaplan_iso_market_expenses_read').then(({data,error})=>{
   if(!alive)return;
   if(error){setError(error.message);return;}
   setGroupId(Number(data.group_id));setAccounts(data.accounts||[]);setExpenses(data.expenses||[]);
  });return()=>{alive=false};
 },[refresh]);
 return <main style={{minHeight:'100vh',background:'#180f18',color:'#fff',padding:'22px'}}>
  <div style={{maxWidth:1100,margin:'auto'}}>
   <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><strong>KAPLAN FİNANS · Beyoğlu Mini Market</strong><button onClick={onLogout}>Çıkış Yap</button></div>
   <div style={{display:'flex',gap:10,margin:'24px 0'}}><button onClick={()=>setTab('expense')} aria-pressed={tab==='expense'}>↗ Giderler</button><button onClick={()=>setTab('cari')} aria-pressed={tab==='cari'}>▣ Cari Hesaplar · Faturalar · Ödemeler</button></div>
   {error&&<p role="alert">{error}</p>}
   {tab==='cari'?<MarketCari admin={false} onChanged={()=>setRefresh(v=>v+1)}/>:<>
    {groupId!==null&&<EntryForm groups={[{id:groupId,name:'Beyoğlu Mini Market'}]} accounts={accounts} fixedGroupId={groupId} mode="expense" onSaved={()=>setRefresh(v=>v+1)}/>}
    <section className="panel" style={{marginTop:18}}><h2>Gider kayıtları</h2>
     <p>Yalnızca Beyoğlu Mini Market giderleri gösterilir. Gelirler ve gelir tutarları erişime kapalıdır.</p>
     <div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Tarih</th><th>Açıklama</th><th>Tutar</th></tr></thead><tbody>{expenses.map(e=><tr key={e.id}><td>{e.document_date}</td><td>{e.description}</td><td>{money(Number(e.amount))}</td></tr>)}</tbody></table></div>
    </section>
   </>}
  </div>
 </main>;
}
