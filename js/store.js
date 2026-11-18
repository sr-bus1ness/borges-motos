// Camada de dados. Mantém tudo em memória (state) e grava:
//  - no Firebase Firestore (nuvem, com cache offline no aparelho), ou
//  - no localStorage (modo local, quando FIREBASE = null).
//
// Estrutura:
//  dias/{AAAA-MM-DD}  { rows: { <id>: { n, s, h, v, o, pago, ord } } }
//  saidas/{AAAA}      { contas: { <id>: { nome, ord, m: { 0..11: valor } } } }
//  estoque/{id}       { produto, qtd, valor, obs, ord }
import { FIREBASE, EMAIL_LOGIN } from './config.js';

const FB_VER = '10.12.2';
// ?local no endereço força o modo de teste (dados só neste navegador)
const USAR_FIREBASE = FIREBASE && !new URLSearchParams(location.search).has('local');
const LOCAL_KEY = 'borges-local-v1';
const COLS = ['dias', 'saidas', 'estoque', 'contas'];

//  contas/{AAAA}      { itens: { <id>: { forn, valor, ord, p: { 0..3: { d: 'AAAA-MM-DD', pago } } } } }
export const state = { dias: {}, saidas: {}, estoque: {}, contas: {} };
export const status = { modo: USAR_FIREBASE ? 'nuvem' : 'local', pendente: false, online: navigator.onLine, erro: '' };

const subs = new Set();
export const onChange = (fn) => subs.add(fn);
const emit = () => subs.forEach((f) => f());

let fb = null;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
function merge(t, p) {
  for (const k in p) {
    const v = p[k];
    if (isObj(v)) { if (!isObj(t[k])) t[k] = {}; merge(t[k], v); }
    else t[k] = v;
  }
  return t;
}

// ---------- aplicação local (otimista) ----------
function applySet(col, id, patch) {
  state[col][id] = merge(state[col][id] || {}, structuredClone(patch));
}
function applyDelField(col, id, path) {
  const parts = path.split('.');
  let o = state[col][id];
  for (let i = 0; o && i < parts.length - 1; i++) o = o[parts[i]];
  if (o) delete o[parts[parts.length - 1]];
}

let saveT;
function saveLocal() {
  if (fb) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch (e) { console.error(e); }
  }, 150);
}
function loadLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (d) for (const c of COLS) state[c] = d[c] || {};
  } catch (e) { console.error(e); }
}

function falha(e) {
  console.error(e);
  status.erro = e && e.message ? e.message : String(e);
  emit();
}

// ---------- operações ----------
function write(col, id, patch) {
  applySet(col, id, patch);
  emit(); saveLocal();
  if (fb) fb.fs.setDoc(fb.fs.doc(fb.db, col, id), patch, { merge: true }).catch(falha);
}
function delField(col, id, path) {
  applyDelField(col, id, path);
  emit(); saveLocal();
  if (fb) fb.fs.updateDoc(fb.fs.doc(fb.db, col, id), { [path]: fb.fs.deleteField() }).catch(falha);
}
function delDoc(col, id) {
  delete state[col][id];
  emit(); saveLocal();
  if (fb) fb.fs.deleteDoc(fb.fs.doc(fb.db, col, id)).catch(falha);
}

export const setRow = (dia, id, patch) => write('dias', dia, { rows: { [id]: patch } });
export const delRow = (dia, id) => delField('dias', dia, `rows.${id}`);
export const setConta = (ano, id, patch) => write('saidas', String(ano), { contas: { [id]: patch } });
export const delConta = (ano, id) => delField('saidas', String(ano), `contas.${id}`);
export const setBoleto = (ano, id, patch) => write('contas', String(ano), { itens: { [id]: patch } });
export const delBoleto = (ano, id) => delField('contas', String(ano), `itens.${id}`);
export const setItem =(id, patch) => write('estoque', id, patch);
export const delItem = (id) => delDoc('estoque', id);

// Importa o JSON gerado a partir da planilha. IDs fixos => importar 2x não duplica.
export async function importar(data) {
  const dias = {};
  (data.entradas || []).forEach((e, i) => {
    (dias[e.d] ||= {})['imp' + i] = {
      n: e.n, s: e.s || '', h: e.h || '', v: e.v ?? null, o: (e.o || '').toUpperCase(), pago: true, ord: i,
    };
  });
  const docs = [];
  for (const d in dias) docs.push(['dias', d, { rows: dias[d] }]);
  for (const ano in data.saidas || {}) {
    const contas = {};
    data.saidas[ano].forEach((c, i) => {
      const m = {};
      (c.m || []).forEach((v, j) => { if (v != null) m[j] = v; });
      contas['imp' + i] = { nome: c.nome, ord: i, m };
    });
    docs.push(['saidas', String(ano), { contas }]);
  }
  // boletos das notas de compra (IDs fixos 'nf0', 'nf1'... => reimportar não duplica)
  const porAno = {};
  (data.contas || []).forEach((c, i) => {
    const p = {};
    (c.p || []).slice(0, 4).forEach((x, k) => { p[k] = { d: x.d, pago: !!x.pago }; });
    (porAno[c.ano] ||= {})['nf' + i] = { forn: (c.forn || '').toUpperCase(), valor: c.valor ?? null, ord: i, p };
  });
  for (const ano in porAno) docs.push(['contas', String(ano), { itens: porAno[ano] }]);
  (data.estoque || []).forEach((e, i) => {
    docs.push(['estoque', 'nf' + i, {
      produto: (e.produto || '').toUpperCase(), qtd: e.qtd ?? null, valor: e.valor ?? null, obs: (e.obs || '').toUpperCase(), ord: i,
    }]);
  });
  for (const [c, id, p] of docs) applySet(c, id, p);
  emit(); saveLocal();
  if (fb) {
    for (let i = 0; i < docs.length; i += 400) {
      const b = fb.fs.writeBatch(fb.db);
      docs.slice(i, i + 400).forEach(([c, id, p]) => b.set(fb.fs.doc(fb.db, c, id), p, { merge: true }));
      await b.commit();
    }
  }
  return docs.length;
}

// ---------- inicialização / login ----------
async function carregarFirebase() {
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
  const [app, auth, fs] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-firestore.js'),
  ]);
  const a = app.initializeApp(FIREBASE);
  const db = fs.initializeFirestore(a, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  fb = { fs, db, authMod: auth, auth: auth.getAuth(a) };
}

function escutar() {
  const pend = {};
  for (const col of COLS) {
    fb.fs.onSnapshot(fb.fs.collection(fb.db, col), { includeMetadataChanges: true }, (snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') delete state[col][ch.doc.id];
        else state[col][ch.doc.id] = ch.doc.data();
      }
      pend[col] = snap.metadata.hasPendingWrites;
      status.pendente = Object.values(pend).some(Boolean);
      emit();
    }, falha);
  }
}

// Retorna 'ok' (pode abrir o sistema) ou 'login' (pedir senha).
export async function iniciar() {
  addEventListener('online', () => { status.online = true; emit(); });
  addEventListener('offline', () => { status.online = false; emit(); });
  if (!USAR_FIREBASE) { loadLocal(); return 'ok'; }
  await carregarFirebase();
  return new Promise((res) => {
    const off = fb.authMod.onAuthStateChanged(fb.auth, (u) => {
      off();
      if (u) { escutar(); res('ok'); } else res('login');
    });
  });
}

export async function entrar(senha) {
  await fb.authMod.signInWithEmailAndPassword(fb.auth, EMAIL_LOGIN, senha);
  escutar();
}

export async function sair() {
  if (fb) await fb.authMod.signOut(fb.auth);
  location.reload();
}
