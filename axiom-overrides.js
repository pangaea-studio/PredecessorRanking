/* AXIOM runtime overrides loaded by index.html before the app boots. */

/* ======================= AXIOM ACCOUNT ADMINISTRATION =======================
   Supabase RPCs expose only the account fields an authenticated admin needs.
   Role changes are re-checked server-side; normal users cannot call them. */
const AdminUserAccess = {
  rows: [], loaded: false, busy: false, error: '',
  async load(force){
    if (!PredSupabase || !Auth.isAdmin) return;
    if (this.busy || (this.loaded && !force)) return;
    this.busy = true; this.error = ''; App.invalidate();
    try {
      const {data, error} = await PredSupabase.rpc('list_app_users');
      if (error) throw error;
      this.rows = Array.isArray(data) ? data : [];
      this.loaded = true;
    } catch (e) { this.error = (e && e.message) || 'Could not load accounts.'; }
    this.busy = false; App.invalidate();
  },
  async setAdmin(uid, makeAdmin){
    if (!PredSupabase || !Auth.isAdmin || !uid) return;
    this.busy = true; this.error = ''; App.invalidate();
    try {
      const {error} = await PredSupabase.rpc('set_user_admin', {target_user_id: uid, make_admin: !!makeAdmin});
      if (error) throw error;
      toast(makeAdmin ? (I18n.lang === 'de' ? 'Admin-Rechte vergeben.' : 'Admin access granted.') : (I18n.lang === 'de' ? 'Admin-Rechte entfernt.' : 'Admin access removed.'));
      this.loaded = false;
      await this.load(true);
      if (uid === Auth.id) await Auth.refreshRole();
    } catch (e) { this.error = (e && e.message) || 'Could not change access.'; }
    this.busy = false; App.invalidate();
  }
};

AdminViews.users = () => {
  const de = I18n.lang === 'de', st = AdminUserAccess;
  if (!st.loaded && !st.busy && !st.error) setTimeout(() => st.load(false), 0);
  const rows = st.rows || [], admins = rows.filter(x => x.is_admin).length;
  const tr = (en, ger) => de ? ger : en;
  const when = iso => iso ? new Date(iso).toLocaleString(de ? 'de-DE' : 'en-GB', {dateStyle:'medium', timeStyle:'short'}) : '—';
  const role = u => h('span', {class:'tag' + (u.is_admin ? ' on' : '')}, u.is_admin ? 'Admin' : tr('User','Nutzer'));
  const action = u => {
    if (u.user_id === Auth.id && u.is_admin) return h('span', {class:'micro'}, tr('Your admin account','Dein Admin-Konto'));
    if (u.is_admin) return confirmBtn(tr('Remove admin','Admin entfernen'), tr('Confirm removal','Entfernen bestätigen'), () => st.setAdmin(u.user_id, false), 'pill sm');
    return confirmBtn(tr('Make admin','Zum Admin machen'), tr('Confirm admin access','Admin-Rechte bestätigen'), () => st.setAdmin(u.user_id, true), 'pill sm solid');
  };
  return h('div', null,
    h('div', {class:'stats'},
      stat(st.loaded ? String(rows.length) : '—', tr('Accounts','Konten'), 'sm'),
      stat(st.loaded ? String(admins) : '—', 'Admins', 'sm')),
    h('div', {class:'spread', style:{marginTop:'28px', alignItems:'center'}},
      h('p', {class:'note', style:{maxWidth:'760px'}}, tr('All registered AXIOM accounts are listed here. Admins can edit official evaluations, weights, tiers, patches, settings and other admin data. Normal users cannot.','Hier siehst du alle registrierten AXIOM-Konten. Admins dürfen offizielle Bewertungen, Gewichte, Tiers, Patches, Einstellungen und andere Admin-Daten bearbeiten. Normale Nutzer dürfen das nicht.')),
      h('button', {class:'pill sm', type:'button', disabled:st.busy, onclick:()=>st.load(true)}, st.busy ? tr('Loading …','Lädt …') : tr('Refresh','Aktualisieren'))),
    st.error ? h('p', {class:'err', role:'alert', style:{marginTop:'20px'}}, st.error) : null,
    !st.loaded ? h('div', {class:'empty', style:{marginTop:'26px'}}, h('p', {class:'note'}, st.busy ? tr('Loading accounts …','Konten werden geladen …') : tr('Accounts are not loaded yet.','Konten sind noch nicht geladen.'))) :
    rows.length ? h('div', {class:'table-wrap', style:{marginTop:'26px'}}, h('table', {class:'data'},
      h('thead', null, h('tr', null,
        h('th',{class:'l'},tr('Account','Konto')), h('th',{class:'l'},'E-Mail'), h('th',{class:'l'},tr('Role','Rolle')), h('th',{class:'l'},tr('Created','Erstellt')), h('th',{class:'l'},tr('Last sign-in','Letzte Anmeldung')), COMMUNITY ? h('th',null,tr('Ratings','Wertungen')) : null, h('th',null,tr('Access','Rechte')))),
      h('tbody', null, rows.map(u => h('tr', null,
        h('td',{class:'l'}, h('b',{style:{fontWeight:400}}, u.display_name || (u.user_id === Auth.id ? tr('You','Du') : tr('User','Nutzer'))), u.user_id === Auth.id ? h('span',{class:'dim',style:{marginLeft:'8px'}},'('+tr('you','du')+')') : null),
        h('td',{class:'l'},u.email || '—'), h('td',{class:'l'},role(u)), h('td',{class:'l muted'},when(u.created_at)), h('td',{class:'l muted'},when(u.last_sign_in_at)), COMMUNITY ? h('td',null,Store.ratings[u.user_id] ? Object.keys(Store.ratings[u.user_id]).length : 0) : null, h('td',null,action(u))))))) :
      h('p',{class:'note',style:{marginTop:'24px'}},tr('No accounts found.','Keine Konten gefunden.')),
    h('p',{class:'note',style:{marginTop:'20px'}},tr('For safety you cannot remove your own admin role from this page. Another admin can change your role.','Zur Sicherheit kannst du dir auf dieser Seite die eigene Admin-Rolle nicht entziehen. Ein anderer Admin kann deine Rolle ändern.'))
  );
};

/* ======================== AUTOMATIC PATCH CARRY-FORWARD ====================
   A new game patch becomes the current AXIOM patch automatically. Until a hero is
   re-published for that patch, the last published AXR stays visible. Draft work never
   replaces the old public value until the new evaluation is published. */
const AxiomPatchCarry = {
  rev: -1, memo: {},
  reset(){ if (this.rev !== Store.rev){ this.rev = Store.rev; this.memo = {}; } },
  exactRows(patch, role){
    const set = Store.evals[patch + ':' + role] || {};
    const rows = Object.keys(set).filter(id => validHeroRole(id, role) && Engine.isPublic(set[id], role)).map(id => ({id, ev:set[id], score:Engine.score(set[id].c, role), sourcePatch:null}))
      .sort((a,b) => b.score - a.score || HERO[a.id].name.localeCompare(HERO[b.id].name));
    rows.forEach((r,i) => { r.rank=i+1; r.tier=Engine.tier(r.score); });
    rows.byId = Object.fromEntries(rows.map(r => [r.id,r]));
    return rows;
  },
  sourcePatch(patch, role){
    const all = Store.patches(), start = all.indexOf(patch);
    if (start < 0) return null;
    for (let i=start+1;i<all.length;i++) if (this.exactRows(all[i],role).length) return all[i];
    return null;
  },
  ranking(patch, role){
    this.reset(); const key=patch+':'+role; if (this.memo[key]) return this.memo[key];
    const exact=this.exactRows(patch,role), src=this.sourcePatch(patch,role);
    if (!src) return this.memo[key]=exact;
    const prev=this.exactRows(src,role), cur=exact.byId || {}, old=prev.byId || {}, ids=new Set([...Object.keys(old),...Object.keys(cur)]), rows=[];
    ids.forEach(id => {
      const r=cur[id] ? Object.assign({},cur[id],{sourcePatch:null}) : old[id] ? Object.assign({},old[id],{sourcePatch:src}) : null;
      if (r) rows.push(r);
    });
    rows.sort((a,b)=>b.score-a.score || HERO[a.id].name.localeCompare(HERO[b.id].name));
    rows.forEach((r,i)=>{r.rank=i+1;r.tier=Engine.tier(r.score);});
    rows.byId=Object.fromEntries(rows.map(r=>[r.id,r]));
    return this.memo[key]=rows;
  },
  info(patch){
    const s=new Set(); ROLES.forEach(r=>this.ranking(patch,r).forEach(x=>{if(x.sourcePatch)s.add(x.sourcePatch);}));
    return s.size ? {patch, sources:[...s]} : null;
  }
};
Engine.ranking = function(patch, role){ return AxiomPatchCarry.ranking(patch, role); };
Engine.movement = function(id, role, patch){
  const a=this.entry(id,role,patch); if (!a || a.sourcePatch) return null;
  const all=Store.patches(), start=all.indexOf(patch);
  for(let i=start+1;i<all.length;i++){ const b=this.entry(id,role,all[i]); if(b && !b.sourcePatch) return b.rank-a.rank; }
  return null;
};

/* ============================= AUDIT LOG UX ================================
   The raw audit record remains untouched. This layer translates technical actions
   into human-readable activity entries and hides raw JSON behind Details. */
const AuditUX = {q:'', kind:'all', actor:'all'};
const AuditReadable = {
  group(action){
    action=String(action||'');
    if(action.startsWith('evaluation.')) return 'evaluation';
    if(action.startsWith('patch.')) return 'patch';
    if(action.startsWith('user.') || action.startsWith('admin.')) return 'access';
    if(action.startsWith('community.')) return 'community';
    if(action.startsWith('live.') || action.startsWith('data.') || action.startsWith('collector.')) return 'data';
    if(action.startsWith('weights.') || action.startsWith('tiers.') || action.startsWith('categories.') || action.startsWith('settings.') || action.startsWith('config.')) return 'config';
    return 'other';
  },
  groupLabel(k,de){
    const m={evaluation:['Evaluation','Bewertung'],patch:['Patch','Patch'],access:['Access','Zugriff'],community:['Community','Community'],data:['Data','Daten'],config:['Configuration','Konfiguration'],other:['Other','Sonstiges']};
    return (m[k]||m.other)[de?1:0];
  },
  title(action,de){
    const m={
      'evaluation.publish':['Evaluation published','Bewertung veröffentlicht'],
      'evaluation.save':['Evaluation saved','Bewertung gespeichert'],
      'evaluation.copy':['Earlier values copied as draft','Frühere Werte als Entwurf übernommen'],
      'evaluation.delete':['Evaluation deleted','Bewertung gelöscht'],
      'weights.update':['Role weights changed','Rollen-Gewichte geändert'],
      'tiers.update':['Tier thresholds changed','Tier-Grenzen geändert'],
      'patch.add':['Patch added','Patch hinzugefügt'],
      'patch.current':['Current patch changed','Aktuellen Patch geändert'],
      'patch.auto_activate':['New patch activated automatically','Neuen Patch automatisch aktiviert'],
      'settings.featured':['Featured hero changed','Featured Hero geändert'],
      'settings.liveApi':['Live data source changed','Live-Datenquelle geändert'],
      'config.import':['Backup imported','Sicherung importiert'],
      'community.delete':['Community ratings deleted','Community-Bewertungen gelöscht'],
      'user.admin_grant':['Admin access granted','Admin-Rechte vergeben'],
      'user.admin_revoke':['Admin access removed','Admin-Rechte entfernt']
    };
    if(m[action]) return m[action][de?1:0];
    return String(action||'').split('.').filter(Boolean).map(x=>x.charAt(0).toUpperCase()+x.slice(1).replace(/_/g,' ')).join(' · ') || (de?'Unbekannte Aktion':'Unknown action');
  },
  key(k,de){
    const m={currentPatch:['Current patch','Aktueller Patch'],valuesInheritedFrom:['Inherited from','Werte übernommen aus'],patchType:['Patch type','Patch-Typ'],releaseAt:['Release','Release'],is_admin:['Admin','Admin'],status:['Status','Status'],map:['Map','Map'],duel:['Duel','Duell'],lane:['Lane','Lane'],safety:['Safety','Sicherheit'],skirmish:['Skirmish','Skirmish'],objective:['Objective','Objective'],teamfight:['Teamfight','Teamfight'],utility:['Utility','Utility']};
    return m[k] ? m[k][de?1:0] : String(k).replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase());
  },
  value(v,de){
    if(v==null) return '—';
    if(typeof v==='boolean') return v ? (de?'Ja':'Yes') : (de?'Nein':'No');
    if(Array.isArray(v)) return v.map(x=>this.value(x,de)).join(' · ');
    if(typeof v==='object') return Object.entries(v).map(([k,x])=>this.key(k,de)+': '+this.value(x,de)).join(' · ');
    const s=String(v); const d=new Date(s); if(/^\d{4}-\d{2}-\d{2}T/.test(s)&&!isNaN(d)) return d.toLocaleString(de?'de-DE':'en-GB',{dateStyle:'medium',timeStyle:'short'});
    return s;
  },
  target(entity,action,de){
    const e=String(entity||'');
    if(action==='patch.auto_activate' || action==='patch.add' || action==='patch.current') return 'Patch '+e;
    const p=e.split(' / ');
    if(p.length>=2){ const hero=HERO[p[0]] ? HERO[p[0]].name : p[0], role=ROLE_LABEL[p[1]]||p[1], patch=p[2]; return [hero,role,patch?'Patch '+patch:null].filter(Boolean).join(' · '); }
    if(e==='thresholds') return de?'Tier-Grenzen':'Tier thresholds';
    if(e==='home') return de?'Startseite':'Home';
    if(e==='live backend') return 'Live-Backend';
    if(ROLES.includes(e)) return ROLE_LABEL[e];
    return e || '—';
  },
  actor(id,de){
    if(!id) return de?'AXIOM-Automatik':'AXIOM automation';
    if(id===Auth.id) return de?'Du':'You';
    const u=(AdminUserAccess.rows||[]).find(x=>x.user_id===id);
    return u ? (u.display_name || u.email || (de?'Admin':'Admin')) : String(id).slice(0,8)+'…';
  },
  summary(a,de){
    const before=a.before, after=a.after, action=String(a.action||'');
    if(action==='patch.auto_activate'){
      const b=before&&before.currentPatch, n=after&&after.currentPatch, from=after&&after.valuesInheritedFrom;
      return (de?'Aktueller Patch: ':'Current patch: ')+(b||'—')+' → '+(n||'—')+(from?' · '+(de?'Werte übernommen aus ':'values inherited from ')+from:'');
    }
    if(action==='user.admin_grant' || action==='user.admin_revoke') return de ? ('Admin: '+this.value(before&&before.is_admin,de)+' → '+this.value(after&&after.is_admin,de)) : ('Admin: '+this.value(before&&before.is_admin,de)+' → '+this.value(after&&after.is_admin,de));
    if(action==='weights.update' && before && after){
      const diff=Object.keys(after).filter(k=>before[k]!==after[k]).map(k=>this.key(k,de)+' '+this.value(before[k],de)+'% → '+this.value(after[k],de)+'%');
      return diff.length?diff.join(' · '):(de?'Keine Wertänderung':'No value change');
    }
    if(action==='tiers.update' && Array.isArray(after)) return after.map(x=>x.t+' ≥ '+x.min).join(' · ');
    if(action.startsWith('evaluation.') && after && typeof after==='object'){
      const status=after.status ? (de?'Status: ':'Status: ')+after.status : '';
      const cats=Object.entries(after).filter(([k,v])=>k!=='status'&&typeof v==='number').map(([k,v])=>this.key(k,de)+' '+Math.round(v));
      return [status,cats.slice(0,4).join(' · '),cats.length>4?'+'+(cats.length-4):''].filter(Boolean).join(' · ');
    }
    if(before==null && after!=null) return (de?'Neu: ':'New: ')+this.value(after,de);
    if(before!=null && after==null) return (de?'Entfernt: ':'Removed: ')+this.value(before,de);
    if(before!=null || after!=null) return this.value(before,de)+' → '+this.value(after,de);
    return '';
  },
  raw(v){ if(v==null)return '—'; try{return JSON.stringify(v,null,2);}catch(e){return String(v);} }
};

AdminViews.audit = () => {
  const de=I18n.lang==='de', tr=(en,ger)=>de?ger:en;
  if(!AdminUserAccess.loaded && !AdminUserAccess.busy && !AdminUserAccess.error) setTimeout(()=>AdminUserAccess.load(false),0);
  const all=(Store.audit||[]).slice().sort((a,b)=>new Date(b.ts||0)-new Date(a.ts||0));
  const now=new Date(), sameDay=iso=>{const d=new Date(iso);return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate();};
  const actors=[...new Set(all.map(a=>a.actor).filter(Boolean))];
  const q=AuditUX.q.trim().toLowerCase();
  const rows=all.filter(a=>{
    const g=AuditReadable.group(a.action), who=AuditReadable.actor(a.actor,de), target=AuditReadable.target(a.entity,a.action,de), title=AuditReadable.title(a.action,de);
    if(AuditUX.kind!=='all'&&g!==AuditUX.kind)return false;
    if(AuditUX.actor!=='all'&&String(a.actor||'system')!==AuditUX.actor)return false;
    if(q && ![who,target,title,a.action,AuditReadable.summary(a,de)].join(' ').toLowerCase().includes(q))return false;
    return true;
  });
  const when=iso=>iso?new Date(iso).toLocaleString(de?'de-DE':'en-GB',{dateStyle:'medium',timeStyle:'short'}):'—';
  const groups=['all','evaluation','patch','config','access','community','data','other'];
  const selectOption=(value,label,current)=>h('option',{value,selected:value===current},label);
  const filterBar=h('div',{class:'filters',style:{marginTop:'30px'}},
    h('label',{class:'lab'},micro(tr('Search','Suche')),h('input',{class:'field',type:'search',value:AuditUX.q,placeholder:tr('Hero, action, admin …','Held, Aktion, Admin …'),onchange:e=>{AuditUX.q=e.target.value;App.render();}})),
    h('label',{class:'lab'},micro(tr('Type','Bereich')),h('select',{class:'field',onchange:e=>{AuditUX.kind=e.target.value;App.render();}},groups.map(k=>selectOption(k,k==='all'?tr('All','Alle'):AuditReadable.groupLabel(k,de),AuditUX.kind)))),
    h('label',{class:'lab'},micro(tr('Actor','Ausgeführt von')),h('select',{class:'field',onchange:e=>{AuditUX.actor=e.target.value;App.render();}},
      selectOption('all',tr('Everyone','Alle'),AuditUX.actor),
      all.some(a=>!a.actor)?selectOption('system',tr('AXIOM automation','AXIOM-Automatik'),AuditUX.actor):null,
      actors.map(id=>selectOption(String(id),AuditReadable.actor(id,de),AuditUX.actor)))),
    h('button',{class:'pill sm',type:'button',onclick:()=>{AuditUX.q='';AuditUX.kind='all';AuditUX.actor='all';App.render();}},tr('Reset','Zurücksetzen'))
  );
  const event=a=>{
    const g=AuditReadable.group(a.action), title=AuditReadable.title(a.action,de), target=AuditReadable.target(a.entity,a.action,de), who=AuditReadable.actor(a.actor,de), summary=AuditReadable.summary(a,de);
    return h('article',{style:{padding:'22px 0',borderBottom:'1px solid rgba(255,255,255,.13)'}},
      h('div',{class:'spread',style:{gap:'18px',alignItems:'flex-start'}},
        h('div',{style:{minWidth:0}},h('p',{class:'micro ink'},h('span',{class:'tag'+(g==='evaluation'||g==='patch'?' on':'')},AuditReadable.groupLabel(g,de)),' ',who),h('h3',{style:{fontSize:'18px',fontWeight:450,margin:'8px 0 0'}},title)),
        h('span',{class:'micro muted',style:{whiteSpace:'nowrap'}},when(a.ts))),
      h('p',{class:'note',style:{marginTop:'9px',maxWidth:'none'}},h('b',{style:{color:'inherit',fontWeight:500}},target),summary?' · '+summary:''),
      (a.before!=null||a.after!=null)?h('details',{style:{marginTop:'12px'}},
        h('summary',{class:'textbtn',style:{cursor:'pointer',display:'inline-block'}},tr('Show details','Details anzeigen')),
        h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:'14px',marginTop:'14px'}},
          h('div',{style:{padding:'14px',border:'1px solid rgba(255,255,255,.12)'}},micro(tr('Before','Vorher')),h('pre',{style:{whiteSpace:'pre-wrap',wordBreak:'break-word',font:'inherit',fontSize:'13px',lineHeight:'1.55',margin:'10px 0 0',color:'#9a9a9a'}},AuditReadable.raw(a.before))),
          h('div',{style:{padding:'14px',border:'1px solid rgba(255,255,255,.12)'}},micro(tr('After','Nachher')),h('pre',{style:{whiteSpace:'pre-wrap',wordBreak:'break-word',font:'inherit',fontSize:'13px',lineHeight:'1.55',margin:'10px 0 0'}},AuditReadable.raw(a.after))))):null);
  };
  return h('div',null,
    h('p',{class:'note',style:{maxWidth:'820px'}},tr('A readable history of admin and automatic changes. The important change is shown first; technical before/after data stays under Details.','Hier siehst du verständlich, wer wann was geändert hat. Die wichtige Änderung steht direkt sichtbar; technische Vorher-/Nachher-Daten liegen unter Details.')),
    h('div',{class:'stats',style:{marginTop:'28px'}},
      stat(String(all.length),tr('All actions','Aktionen gesamt'),'sm'),
      stat(String(all.filter(a=>sameDay(a.ts)).length),tr('Today','Heute'),'sm'),
      stat(String(all.filter(a=>AuditReadable.group(a.action)==='evaluation').length),tr('Evaluations','Bewertungen'),'sm'),
      stat(String(all.filter(a=>!a.actor).length),tr('Automatic','Automatisch'),'sm')),
    filterBar,
    h('p',{class:'note',style:{marginTop:'20px'}},rows.length+' '+tr(rows.length===1?'entry':'entries',rows.length===1?'Eintrag':'Einträge')),
    rows.length?h('div',{style:{marginTop:'6px'}},rows.map(event)):h('div',{class:'empty',style:{marginTop:'26px'}},h('p',{class:'note'},all.length?tr('No entries match these filters.','Keine Einträge passen zu diesen Filtern.'):tr('No admin actions recorded yet.','Noch keine Admin-Aktionen aufgezeichnet.')))
  );
};
