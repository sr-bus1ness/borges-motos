import * as S from './store.js';
import { SERVICOS, LIMITE_MEI, EMAIL_LOGIN } from './config.js';

// ============ utilidades ============
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoje = () => iso(new Date());
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dataBr = (s) => s.split('-').reverse().join('/');
const addDias = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
const agora = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmt = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const reais = (v) => 'R$ ' + fmt(v || 0);
const porOrd = (a, b) => (a[1].ord ?? 0) - (b[1].ord ?? 0);
const finoPonteiro = matchMedia('(pointer: fine)').matches;

function numero(str) {
  let s = String(str ?? '').trim().replace(/r\$\s*/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

// ============ estado da tela ============
const ui = { aba: 'entrada', dia: hoje(), ano: new Date().getFullYear(), calMes: new Date().getMonth(), calSel: null, busca: '', buscaEst: '', foco: null };
const ABAS = [['entrada', 'Entrada'], ['receber', 'A Receber'], ['contas', 'Contas'], ['saidas', 'Saídas'], ['dash', 'Dashboards'], ['estoque', 'Estoque']];
const MESES_LONGO = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const app = $('#app');
let view;

// ============ casca ============
function casca() {
  app.innerHTML = `
  <header class="top">
    <div class="brand">BORGES <b>MOTOS</b></div>
    <nav class="tabs">${ABAS.map(([k, l]) => `<button data-aba="${k}">${l}</button>`).join('')}</nav>
    <div class="tools">
      <span class="sync" id="sync"></span>
      <div class="menuwrap">
        <button class="icon" id="menuBtn" aria-label="Menu" aria-haspopup="true">
          <svg viewBox="0 0 24 24" width="20" height="20"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
        </button>
        <div class="menu" id="menu" hidden>
          <button data-menu="exportar">Exportar backup (Excel)</button>
          <button data-menu="importar">Importar histórico da planilha…</button>
          ${S.status.modo === 'nuvem' ? '<button data-menu="sair">Sair</button>' : ''}
        </div>
      </div>
    </div>
  </header>
  <main id="view"></main>
  <div id="toast" class="toast" hidden></div>
  <input type="file" id="arqImp" accept=".json,application/json" hidden>`;
  view = $('#view');

  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-aba]');
    if (t) { ui.aba = t.dataset.aba; ui.foco = ui.aba === 'entrada' && finoPonteiro ? 'novo' : null; window.scrollTo(0, 0); render(); }
  });
  $('#menuBtn').onclick = (e) => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; };
  document.addEventListener('click', () => { $('#menu').hidden = true; });
  $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]'); if (!b) return;
    if (b.dataset.menu === 'exportar') exportar();
    if (b.dataset.menu === 'importar') $('#arqImp').click();
    if (b.dataset.menu === 'sair' && confirm('Sair do sistema neste aparelho?')) S.sair();
  });
  $('#arqImp').onchange = importarArquivo;

  view.addEventListener('click', clique);
  view.addEventListener('keydown', tecla);
  view.addEventListener('change', mudou);
  view.addEventListener('input', digitou);
  view.addEventListener('mouseover', dicaGrafico);
  view.addEventListener('mouseleave', () => { const t = $('#gtip'); if (t) t.hidden = true; });
  view.addEventListener('click', (e) => { if (e.target.closest('.g-mes')) dicaGrafico(e); }); // toque no celular
  document.addEventListener('keydown', (e) => {
    if (ui.aba !== 'entrada' || ui.busca) return;
    if (e.key === 'PageUp') { e.preventDefault(); irDia(-1); }
    if (e.key === 'PageDown') { e.preventDefault(); irDia(1); }
  });
}

// ============ render com preservação de foco ============
let agendado = false;
function agendar() {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => { agendado = false; render(); });
}

function render() {
  const a = document.activeElement;
  let manter = null;
  if (a && a.dataset && a.dataset.k && view.contains(a)) {
    manter = { k: a.dataset.k, v: a.value, sujo: a.dataset.sujo === '1', s: a.selectionStart, e: a.selectionEnd };
  }
  const rolagens = {};
  view.querySelectorAll('[data-sc]').forEach((el) => { rolagens[el.dataset.sc] = el.scrollLeft; });

  app.querySelectorAll('[data-aba]').forEach((b) => b.classList.toggle('on', b.dataset.aba === ui.aba));
  ({ entrada: vEntrada, receber: vReceber, contas: vContas, saidas: vSaidas, dash: vDash, estoque: vEstoque })[ui.aba]();
  selo();

  view.querySelectorAll('[data-sc]').forEach((el) => { if (rolagens[el.dataset.sc]) el.scrollLeft = rolagens[el.dataset.sc]; });

  const achar = (k) => view.querySelector(`[data-k="${CSS.escape(k)}"]`);
  if (ui.foco) {
    const el = achar(ui.foco); ui.foco = null;
    if (el) { el.focus(); el.select?.(); return; }
  }
  if (manter) {
    const el = achar(manter.k);
    if (el) {
      if (manter.sujo) { el.value = manter.v; el.dataset.sujo = '1'; }
      el.focus();
      try { el.setSelectionRange(manter.s, manter.e); } catch { /* inputs sem seleção */ }
    }
  }
}

function selo() {
  const el = $('#sync'); if (!el) return;
  let cls = 'ok', txt = 'Sincronizado';
  if (S.status.modo === 'local') { cls = 'local'; txt = 'Modo local (teste)'; }
  else if (S.status.erro) { cls = 'bad'; txt = 'Erro ao salvar'; }
  else if (!S.status.online) { cls = 'warn'; txt = 'Offline · salvo no aparelho'; }
  else if (S.status.pendente) { cls = 'warn'; txt = 'Salvando…'; }
  el.className = 'sync ' + cls;
  el.title = S.status.erro || txt;
  el.innerHTML = `<i></i><span>${txt}</span>`;
}

// ============ ENTRADA ============
function linhasDoDia(dia) {
  const rows = S.state.dias[dia]?.rows || {};
  return Object.entries(rows).sort(porOrd).map(([id, r]) => ({ d: dia, id, r }));
}

function vEntrada() {
  const buscando = ui.busca.trim() !== '';
  let linhas;
  if (buscando) {
    const q = norm(ui.busca.trim());
    linhas = [];
    for (const d in S.state.dias) {
      const rows = S.state.dias[d].rows || {};
      for (const id in rows) if (norm(rows[id].o).includes(q)) linhas.push({ d, id, r: rows[id] });
    }
    linhas.sort((a, b) => b.d.localeCompare(a.d) || (b.r.ord ?? 0) - (a.r.ord ?? 0));
  } else linhas = linhasDoDia(ui.dia);

  const LIM = 300;
  const mostrar = linhas.slice(0, LIM);
  const legenda = Object.entries(SERVICOS).map(([n, s]) => `<span><b>${n}</b> ${esc(s.nome)}</span>`).join('');

  view.innerHTML = `
  <section class="folha">
    <div class="barra-data ${buscando ? 'apagada' : ''}">
      <button class="nav" data-act="dprev" aria-label="Dia anterior">◀</button>
      <button class="data" data-act="pick">${dataBr(ui.dia)}${ui.dia === hoje() ? '' : '<small>' + diaSemana(ui.dia) + '</small>'}</button>
      <input type="date" id="pick" value="${ui.dia}" tabindex="-1" aria-hidden="true">
      <button class="nav" data-act="dnext" aria-label="Próximo dia">▶</button>
    </div>
    <div class="tabela">
    <table class="grid entrada">
      <colgroup><col class="w-n"><col class="w-s"><col class="w-h"><col class="w-v"><col><col class="w-p"></colgroup>
      <thead><tr>
        <th class="c">Nº</th><th>Peças/Serviços</th><th class="c-h">${buscando ? 'Data' : 'Hora'}</th><th class="r">Valor</th>
        <th class="th-busca"><label class="busca">
          <svg viewBox="0 0 24 24" width="15" height="15"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input data-k="busca" data-busca="entrada" placeholder="Obs · pesquisar" value="${esc(ui.busca)}" autocomplete="off">
          ${buscando ? '<button data-act="limpar" aria-label="Limpar pesquisa">×</button>' : ''}
        </label></th>
        <th class="c">Pago</th>
      </tr></thead>
      <tbody>
        ${mostrar.map((l, i) => linhaEntrada(l, i, buscando)).join('')}
        ${buscando ? '' : `<tr class="novo">
          <td class="c"><input data-k="novo" data-f="novo" data-row="${mostrar.length}" data-col="0" inputmode="numeric" placeholder="+" autocomplete="off"></td>
          <td colspan="5" class="legenda">${legenda}</td></tr>`}
      </tbody>
    </table>
    </div>
    ${buscando ? `<p class="nota">${linhas.length ? `${linhas.length} resultado${linhas.length > 1 ? 's' : ''} em todas as datas${linhas.length > LIM ? ` (mostrando ${LIM})` : ''}` : 'Nada encontrado.'}</p>` : ''}
  </section>`;
}

function diaSemana(s) {
  return fromIso(s).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
}

function linhaEntrada({ d, id, r }, i, buscando) {
  const k = `${d}|${id}`;
  const nome = SERVICOS[r.n]?.nome || r.s || '';
  return `<tr data-d="${d}" data-id="${id}" class="${r.pago ? 'pago' : ''}">
    <td class="c"><input data-k="${k}|n" data-f="n" data-row="${i}" data-col="0" value="${esc(r.n ?? '')}" inputmode="numeric" autocomplete="off"></td>
    <td class="serv">${esc(nome)}</td>
    <td class="c-h muted">${buscando ? `<button class="link" data-act="ir" data-d="${d}">${dataBr(d)}</button>` : esc(r.h || '')}</td>
    <td class="r"><input data-k="${k}|v" data-f="v" data-row="${i}" data-col="1" value="${fmt(r.v)}" inputmode="decimal" autocomplete="off" class="r"></td>
    <td><input data-k="${k}|o" data-f="o" data-row="${i}" data-col="2" value="${esc(r.o || '')}" autocomplete="off" class="up"></td>
    <td class="c"><button class="chk ${r.pago ? 'on' : ''}" data-act="pago" aria-pressed="${!!r.pago}" aria-label="Pago"></button></td>
  </tr>`;
}

function irDia(n) {
  ui.dia = addDias(ui.dia, n);
  if (finoPonteiro) ui.foco = 'novo';
  render();
}

function novoLancamento(el) {
  const raw = el.value.trim();
  el.value = ''; delete el.dataset.sujo;
  if (!raw) return;
  const n = parseInt(raw, 10);
  const sv = SERVICOS[n];
  if (!sv || String(n) !== raw) { toast('Serviço inválido — use 1 a ' + Object.keys(SERVICOS).length); return; }
  const id = S.uid();
  ui.foco = `${ui.dia}|${id}|${sv.preco != null ? 'o' : 'v'}`;
  S.setRow(ui.dia, id, { n, s: sv.nome, h: agora(), v: sv.preco ?? null, o: '', pago: false, ord: Date.now() });
}

function salvarEntrada(el) {
  const tr = el.closest('tr');
  const d = tr.dataset.d, id = tr.dataset.id;
  const r = S.state.dias[d]?.rows?.[id];
  delete el.dataset.sujo;
  if (!r) return;
  const f = el.dataset.f;
  if (f === 'n') {
    if (!el.value.trim()) { // apagou o nº => apaga a linha inteira
      const copia = structuredClone(r);
      S.delRow(d, id);
      toast('Lançamento apagado', 'Desfazer', () => S.setRow(d, id, copia));
      return 'apagou';
    }
    const n = parseInt(el.value, 10), sv = SERVICOS[n];
    if (!sv) { el.value = r.n ?? ''; toast('Serviço inválido'); return; }
    if (n !== r.n) {
      const p = { n, s: sv.nome };
      if (sv.preco != null && r.v == null) p.v = sv.preco;
      S.setRow(d, id, p);
    }
  } else if (f === 'v') {
    const v = numero(el.value);
    if (Number.isNaN(v)) { el.value = fmt(r.v); toast('Valor inválido'); return; }
    if (v !== r.v) S.setRow(d, id, { v });
    else el.value = fmt(r.v);
  } else if (f === 'o') {
    const o = el.value.trim().toUpperCase();
    if (o !== (r.o || '')) S.setRow(d, id, { o });
  }
}

// ============ A RECEBER ============
function pendentes(filtroAno) {
  const out = [];
  for (const d in S.state.dias) {
    if (filtroAno && !d.startsWith(filtroAno)) continue;
    const rows = S.state.dias[d].rows || {};
    for (const id in rows) if (!rows[id].pago && rows[id].n != null) out.push({ d, id, r: rows[id] });
  }
  return out.sort((a, b) => a.d.localeCompare(b.d) || (a.r.ord ?? 0) - (b.r.ord ?? 0));
}

function vReceber() {
  const lista = pendentes();
  const total = lista.reduce((s, l) => s + (l.r.v || 0), 0);
  view.innerHTML = `
  <section class="folha">
    <div class="cab">
      <h1>A Receber</h1>
      <div class="kpi-inline"><span>${lista.length} pendente${lista.length === 1 ? '' : 's'}</span><b>${reais(total)}</b></div>
    </div>
    ${lista.length ? `
    <div class="tabela"><table class="grid">
      <colgroup><col class="w-d"><col><col class="w-s"><col class="w-v"><col class="w-p"></colgroup>
      <thead><tr><th>Data</th><th>Nome</th><th>Serviço</th><th class="r">Valor</th><th class="c">Pago</th></tr></thead>
      <tbody>${lista.map(({ d, id, r }) => `
        <tr data-d="${d}" data-id="${id}">
          <td><button class="link" data-act="ir" data-d="${d}">${dataBr(d)}</button></td>
          <td class="strong">${esc(r.o) || '<span class="muted">—</span>'}</td>
          <td class="serv">${esc(SERVICOS[r.n]?.nome || r.s || '')}</td>
          <td class="r num">${r.v == null ? '<span class="muted">—</span>' : fmt(r.v)}</td>
          <td class="c"><button class="chk" data-act="pago" aria-pressed="false" aria-label="Marcar como pago"></button></td>
        </tr>`).join('')}</tbody>
    </table></div>` : '<p class="vazio">Nenhum valor pendente.</p>'}
  </section>`;
}

// ============ CONTAS (boletos de fornecedores) ============
const dataCurta = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : '');

function boletosDoAno(ano) {
  return Object.entries(S.state.contas[String(ano)]?.itens || {}).sort(porOrd);
}
// parcelas preenchidas de um boleto; valor da parcela = valor total ÷ nº de datas
function parcelas(b) {
  const ps = [0, 1, 2, 3].map((k) => ({ ...(b.p?.[k] || {}), slot: k })).filter((p) => p.d);
  const v = ps.length ? (Number(b.valor) || 0) / ps.length : 0;
  return ps.map((p, i) => ({ ...p, k: i + 1, n: ps.length, v }));
}
function todasParcelas() {
  const out = [];
  for (const ano in S.state.contas) {
    const itens = S.state.contas[ano].itens || {};
    for (const id in itens) parcelas(itens[id]).forEach((p) => out.push({ ...p, forn: itens[id].forn, id, ano }));
  }
  return out;
}
function boletosPorMes(ano) {
  const m = Array(12).fill(0);
  todasParcelas().forEach((p) => { if (p.d.startsWith(ano + '-')) m[Number(p.d.slice(5, 7)) - 1] += p.v; });
  return m;
}

// aceita 20/11, 20/11/26, 20/11/2026, 2011, 201126, 20112026
function lerData(str, ano, anterior) {
  const s = String(str).trim();
  if (!s) return null;
  let d, m, y;
  if (/^\d{1,2}[/.-]\d{1,2}([/.-]\d{2}(\d{2})?)?$/.test(s)) [d, m, y] = s.split(/[/.-]/).map(Number);
  else if (/^(\d{4}|\d{6}|\d{8})$/.test(s)) { d = +s.slice(0, 2); m = +s.slice(2, 4); y = s.length > 4 ? +s.slice(4) : undefined; }
  else return NaN;
  if (y === undefined) {
    y = Number(ano);
    if (anterior && `${y}-${pad(m)}-${pad(d)}` < anterior) y++; // parcela que vira o ano
  } else if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return NaN;
  return iso(dt);
}

function calendario() {
  const ano = ui.ano, mes = ui.calMes, hj = hoje();
  const porDia = {};
  todasParcelas().forEach((p) => (porDia[p.d] ||= []).push(p));
  const ini = new Date(ano, mes, 1).getDay();
  const nd = new Date(ano, mes + 1, 0).getDate();
  let cel = '';
  for (let i = 0; i < ini; i++) cel += '<span></span>';
  for (let d = 1; d <= nd; d++) {
    const k = `${ano}-${pad(mes + 1)}-${pad(d)}`;
    const ps = porDia[k] || [];
    cel += `<button class="dia ${k === hj ? 'hoje' : ''} ${k === ui.calSel ? 'sel' : ''}" data-act="calDia" data-d="${k}"
      aria-label="${d}${ps.length ? `, ${ps.length} boleto(s)` : ''}"><span>${d}</span><i class="pts">${ps.slice(0, 4).map((p) => `<b class="${p.pago ? 'ok' : 'ab'}"></b>`).join('')}</i></button>`;
  }
  const prefixo = `${ano}-${pad(mes + 1)}`;
  const doMes = Object.keys(porDia).filter((k) => k.startsWith(prefixo)).flatMap((k) => porDia[k]);
  const aPagar = doMes.filter((p) => !p.pago).reduce((s, p) => s + p.v, 0);
  const pago = doMes.filter((p) => p.pago).reduce((s, p) => s + p.v, 0);
  let sel = '';
  if (ui.calSel && ui.calSel.startsWith(prefixo)) {
    const ps = porDia[ui.calSel] || [];
    sel = `<div class="cal-dia"><h4>VENCE EM ${dataBr(ui.calSel)}</h4>${ps.length ? ps.map((p) => `
      <div><span>${esc(p.forn)} <small>${p.k}/${p.n}</small></span><span class="st">${fmt(p.v)}<b class="${p.pago ? 'ok' : 'ab'}" style="width:6px;height:6px;border-radius:50%"></b></span></div>`).join('')
      : '<div class="muted">Nenhum boleto.</div>'}</div>`;
  }
  return `
    <div class="cal-nav"><button class="nav" data-act="aprev" aria-label="Ano anterior">◀</button><b>${ano}</b><button class="nav" data-act="anext" aria-label="Próximo ano">▶</button></div>
    <div class="cal-nav"><button class="nav" data-act="mprev" aria-label="Mês anterior">◀</button><b>${MESES_LONGO[mes]}</b><button class="nav" data-act="mnext" aria-label="Próximo mês">▶</button></div>
    <div class="cal-grid">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((x) => `<span class="dsem">${x}</span>`).join('')}${cel}</div>
    <div class="cal-leg"><span><b class="ab"></b>a pagar</span><span><b class="ok"></b>pago</span></div>
    <div class="cal-res"><div><span>A pagar no mês</span><b>${reais(aPagar)}</b></div><div><span>Pago no mês</span><b>${reais(pago)}</b></div></div>
    ${sel}`;
}

function vContas() {
  const ano = ui.ano, itens = boletosDoAno(ano);
  const total = itens.reduce((s, [, b]) => s + (Number(b.valor) || 0), 0);
  const pct = Math.min(100, (total / LIMITE_MEI) * 100);
  view.innerHTML = `
  <section class="folha larga contas">
    <aside class="cal">${calendario()}</aside>
    <div class="contas-main">
      <div class="tabela rola" data-sc="contas"><table class="grid boletos">
        <thead><tr><th class="fixa">Fornecedor</th><th>Valor</th><th>1ª parcela</th><th>2ª parcela</th><th>3ª parcela</th><th>4ª parcela</th><th></th></tr></thead>
        <tbody>
          ${itens.map(([id, b], i) => `<tr data-id="${id}">
            <td class="fixa"><input data-k="b|${id}|forn" data-cf="forn" data-row="${i}" data-col="0" value="${esc(b.forn)}" class="up strong" autocomplete="off"></td>
            <td><input data-k="b|${id}|valor" data-cf="valor" data-row="${i}" data-col="1" value="${fmt(b.valor)}" inputmode="decimal" autocomplete="off"></td>
            ${[0, 1, 2, 3].map((k) => { const p = b.p?.[k] || {}; return `<td class="parc"><div>
              <input data-k="b|${id}|p${k}" data-cf="p${k}" data-row="${i}" data-col="${k + 2}" value="${dataCurta(p.d)}" placeholder="dd/mm" inputmode="numeric" autocomplete="off">
              <button class="chk ${p.pago ? 'on' : ''}" data-act="pagoParc" data-p="${k}" ${p.d ? '' : 'disabled'} aria-pressed="${!!p.pago}" aria-label="Parcela ${k + 1} paga"></button>
            </div></td>`; }).join('')}
            <td class="c"><button class="del" data-act="delboleto" aria-label="Apagar boleto">×</button></td>
          </tr>`).join('')}
          <tr class="novo"><td class="fixa"><input data-k="novoboleto" data-cf="novo" data-row="${itens.length}" data-col="0" placeholder="+ novo fornecedor" class="up" autocomplete="off"></td><td colspan="6"></td></tr>
        </tbody>
      </table></div>
      <div class="mei">
        <div class="mei-top"><span>Total em boletos ${ano}</span><b>${reais(total)}</b></div>
        <div class="mei-bar" role="img" aria-label="${pct.toFixed(1)}% do limite MEI"><i style="width:${pct}%" class="${pct >= 90 ? 'alto' : ''}"></i></div>
        <div class="mei-leg"><span>${pct.toFixed(1).replace('.', ',')}% do limite MEI</span><span>Restam ${reais(Math.max(0, LIMITE_MEI - total))} de ${reais(LIMITE_MEI)}</span></div>
      </div>
    </div>
  </section>`;
}

function salvarBoleto(el) {
  delete el.dataset.sujo;
  const f = el.dataset.cf, ano = ui.ano;
  if (f === 'novo') {
    const forn = el.value.trim().toUpperCase(); el.value = '';
    if (!forn) return;
    const id = S.uid();
    ui.foco = `b|${id}|valor`;
    S.setBoleto(ano, id, { forn, valor: null, ord: Date.now(), p: {} });
    return;
  }
  const id = el.closest('tr').dataset.id;
  const b = S.state.contas[String(ano)]?.itens?.[id]; if (!b) return;
  if (f === 'forn') {
    const v = el.value.trim().toUpperCase();
    if (v && v !== b.forn) S.setBoleto(ano, id, { forn: v }); else el.value = b.forn;
  } else if (f === 'valor') {
    const v = numero(el.value);
    if (Number.isNaN(v)) { el.value = fmt(b.valor); toast('Valor inválido'); return; }
    if (v !== (b.valor ?? null)) S.setBoleto(ano, id, { valor: v }); else el.value = fmt(v);
  } else {
    const k = Number(f.slice(1));
    let ant = null;
    for (let j = k - 1; j >= 0; j--) if (b.p?.[j]?.d) { ant = b.p[j].d; break; }
    const atual = b.p?.[k];
    const d = lerData(el.value, ano, ant);
    if (Number.isNaN(d)) { el.value = dataCurta(atual?.d); toast('Data inválida — use dd/mm'); return; }
    if (d === null) { if (atual?.d) S.setBoleto(ano, id, { p: { [k]: { d: null, pago: false } } }); }
    else if (d !== atual?.d) S.setBoleto(ano, id, { p: { [k]: { d, pago: !!atual?.pago } } });
    else el.value = dataCurta(d);
  }
}

// ============ SAÍDAS ============
function barraAno() {
  return `<div class="barra-data">
    <button class="nav" data-act="aprev" aria-label="Ano anterior">◀</button>
    <span class="data">${ui.ano}</span>
    <button class="nav" data-act="anext" aria-label="Próximo ano">▶</button>
  </div>`;
}

function contasDoAno(ano) {
  return Object.entries(S.state.saidas[String(ano)]?.contas || {}).sort(porOrd);
}

function vSaidas() {
  const contas = contasDoAno(ui.ano);
  const anterior = contasDoAno(ui.ano - 1);
  const bol = boletosPorMes(ui.ano);
  const tot = MESES.map((_, j) => contas.reduce((s, [, c]) => s + (Number(c.m?.[j]) || 0), 0) + bol[j]);
  const totAno = tot.reduce((a, b) => a + b, 0);
  view.innerHTML = `
  <section class="folha larga">
    ${barraAno()}
    ${!contas.length && anterior.length ? `<div class="aviso">Nenhuma conta em ${ui.ano}. <button class="btn" data-act="copiar">Copiar as ${anterior.length} contas de ${ui.ano - 1}</button></div>` : ''}
    <div class="tabela rola" data-sc="saidas"><table class="grid saidas">
      <thead><tr><th class="fixa">Conta</th>${MESES.map((m) => `<th class="r">${m}</th>`).join('')}<th></th></tr></thead>
      <tbody>
        ${contas.map(([id, c], i) => `<tr data-id="${id}">
          <td class="fixa"><input data-k="c|${id}|nome" data-sf="nome" data-row="${i}" data-col="0" value="${esc(c.nome)}" class="up strong" autocomplete="off"></td>
          ${MESES.map((_, j) => `<td><input data-k="c|${id}|${j}" data-sf="${j}" data-row="${i}" data-col="${j + 1}" value="${fmt(c.m?.[j])}" inputmode="decimal" class="r" autocomplete="off"></td>`).join('')}
          <td class="c"><button class="del" data-act="delconta" aria-label="Apagar conta">×</button></td>
        </tr>`).join('')}
        <tr class="calc" title="Calculado automaticamente pela aba Contas (parcelas pelo mês de vencimento)">
          <td class="fixa">BOLETOS FORNECEDORES</td>${bol.map((v) => `<td class="num">${v ? fmt(v) : ''}</td>`).join('')}<td></td></tr>
        <tr class="novo"><td class="fixa"><input data-k="novaconta" data-sf="nova" data-row="${contas.length}" data-col="0" placeholder="+ nova conta" class="up" autocomplete="off"></td><td colspan="13"></td></tr>
      </tbody>
      <tfoot><tr><td class="fixa">TOTAL</td>${tot.map((v) => `<td class="r num">${fmt(v)}</td>`).join('')}<td></td></tr></tfoot>
    </table></div>
    <p class="nota">Total de ${ui.ano}: <b>${reais(totAno)}</b></p>
  </section>`;
}

function salvarSaida(el) {
  delete el.dataset.sujo;
  const f = el.dataset.sf;
  if (f === 'nova') {
    const nome = el.value.trim().toUpperCase(); el.value = '';
    if (!nome) return;
    const id = S.uid();
    S.setConta(ui.ano, id, { nome, ord: Date.now(), m: {} });
    ui.foco = `c|${id}|${new Date().getFullYear() === ui.ano ? new Date().getMonth() : 0}`;
    return;
  }
  const id = el.closest('tr').dataset.id;
  const c = S.state.saidas[String(ui.ano)]?.contas?.[id]; if (!c) return;
  if (f === 'nome') {
    const nome = el.value.trim().toUpperCase();
    if (nome && nome !== c.nome) S.setConta(ui.ano, id, { nome }); else el.value = c.nome;
  } else {
    const v = numero(el.value);
    if (Number.isNaN(v)) { el.value = fmt(c.m?.[f]); toast('Valor inválido'); return; }
    if (v !== (c.m?.[f] ?? null)) S.setConta(ui.ano, id, { m: { [f]: v } }); else el.value = fmt(v);
  }
}

// ============ DASHBOARDS ============
let dashDados = null;
const curto = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(Math.round(v)));

function topoBonito(max) {
  if (max <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / (p / 2)) * (p / 2);
}

function grafico(ent, sai) {
  const topo = topoBonito(Math.max(...ent, ...sai));
  const h = (v) => `${Math.max(0, (v / topo) * 100)}%`;
  return `<div class="graf">
    <div class="graf-cab"><h2>Entrada × Saída por mês</h2>
      <div class="leg"><span><i class="e"></i>Entrada</span><span><i class="s"></i>Saída</span></div></div>
    <div class="graf-area">
      <div class="g-eixo"><span>${curto(topo)}</span><span>${curto(topo / 2)}</span><span>0</span></div>
      <div class="g-plot">
        <i class="g-linha" style="top:0"></i><i class="g-linha" style="top:calc(50% - 9px)"></i>
        ${MESES.map((m, j) => `<div class="g-mes" data-j="${j}">
          <div class="g-barras"><i class="e" style="height:${h(ent[j])}"></i><i class="s" style="height:${h(sai[j])}"></i></div>
          <span>${m}</span></div>`).join('')}
      </div>
    </div>
    <div class="g-tip" id="gtip" hidden></div>
  </div>`;
}

function barraShare(v, total) {
  const pct = total ? (v / total) * 100 : 0;
  return `<div class="share"><span class="trilho"><i style="width:${pct}%"></i></span><em>${pct.toFixed(0)}%</em></div>`;
}

function dicaGrafico(e) {
  const tip = $('#gtip'); if (!tip || !dashDados) return;
  const g = e.target.closest('.g-mes');
  if (!g) { tip.hidden = true; return; }
  const j = +g.dataset.j, { ent, sai } = dashDados, sd = ent[j] - sai[j];
  tip.innerHTML = `<h5>${MESES_LONGO[j]} ${ui.ano}</h5>
    <div><span><i style="background:var(--s-ent)"></i>Entrada</span><b>${reais(ent[j])}</b></div>
    <div><span><i style="background:var(--s-sai)"></i>Saída</span><b>${reais(sai[j])}</b></div>
    <div class="sd"><span>Saldo</span><b class="${sd < 0 ? 'neg' : 'pos'}">${reais(sd)}</b></div>`;
  tip.hidden = false;
  const box = tip.parentElement.getBoundingClientRect(), r = g.getBoundingClientRect();
  let x = r.left - box.left + r.width / 2 - tip.offsetWidth / 2;
  x = Math.max(8, Math.min(x, box.width - tip.offsetWidth - 8));
  tip.style.left = x + 'px';
  tip.style.top = (r.top - box.top + 8) + 'px';
}

function vDash() {
  const ano = String(ui.ano);
  const serv = {}; const ent = Array(12).fill(0); let outros = { q: 0, v: 0 };
  for (const n in SERVICOS) serv[n] = { q: 0, v: 0 };
  for (const d in S.state.dias) {
    if (!d.startsWith(ano)) continue;
    const mes = Number(d.slice(5, 7)) - 1;
    const rows = S.state.dias[d].rows || {};
    for (const id in rows) {
      const r = rows[id]; const v = Number(r.v) || 0;
      ent[mes] += v;
      const alvo = serv[r.n] || outros; alvo.q++; alvo.v += v;
    }
  }
  const bol = boletosPorMes(ano);
  const sai = MESES.map((_, j) => contasDoAno(ano).reduce((s, [, c]) => s + (Number(c.m?.[j]) || 0), 0) + bol[j]);
  dashDados = { ent, sai };
  const totEnt = ent.reduce((a, b) => a + b, 0), totSai = sai.reduce((a, b) => a + b, 0);
  const rec = pendentes(ano).reduce((s, l) => s + (l.r.v || 0), 0);
  const qtd = Object.values(serv).reduce((s, x) => s + x.q, 0) + outros.q;
  const sinal = (v) => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');

  view.innerHTML = `
  <section class="folha larga">
    ${barraAno()}
    <div class="kpis">
      <div class="kpi"><span>Entrada</span><b>${reais(totEnt)}</b></div>
      <div class="kpi"><span>Saída</span><b>${reais(totSai)}</b></div>
      <div class="kpi"><span>Saldo</span><b class="${sinal(totEnt - totSai)}">${reais(totEnt - totSai)}</b></div>
      <div class="kpi"><span>A receber</span><b>${reais(rec)}</b></div>
    </div>
    <div class="dash">
      ${grafico(ent, sai)}
      <div class="tabela rola"><table class="grid" style="min-width:560px">
        <colgroup><col style="width:56px"><col><col style="width:90px"><col style="width:140px"><col style="width:200px" class="w-share"></colgroup>
        <thead><tr><th class="c">Nº</th><th>Serviço</th><th class="r">Qtd</th><th class="r">Valor</th><th>Participação</th></tr></thead>
        <tbody>
          ${Object.entries(SERVICOS).map(([n, s]) => `<tr><td class="c muted">${n}</td><td class="serv">${esc(s.nome)}</td><td class="r num">${serv[n].q}</td><td class="r num">${fmt(serv[n].v)}</td><td>${barraShare(serv[n].v, totEnt)}</td></tr>`).join('')}
          ${outros.q ? `<tr><td class="c muted">–</td><td class="serv">OUTROS</td><td class="r num">${outros.q}</td><td class="r num">${fmt(outros.v)}</td><td>${barraShare(outros.v, totEnt)}</td></tr>` : ''}
        </tbody>
        <tfoot><tr><td></td><td>TOTAL GERAL</td><td class="r num">${qtd}</td><td class="r num">${fmt(totEnt)}</td><td></td></tr></tfoot>
      </table></div>
      <div class="tabela rola" data-sc="dash"><table class="grid meses">
        <thead><tr><th class="fixa">${ano}</th>${MESES.map((m) => `<th class="r">${m}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><td class="fixa">ENTRADA</td>${ent.map((v) => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
          <tr><td class="fixa">SAÍDA</td>${sai.map((v) => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
        </tbody>
        <tfoot><tr><td class="fixa">SALDO</td>${ent.map((v, j) => `<td class="r num ${sinal(v - sai[j])}">${fmt(v - sai[j])}</td>`).join('')}</tr></tfoot>
      </table></div>
    </div>
  </section>`;
}

// ============ ESTOQUE ============
function vEstoque() {
  const q = norm(ui.buscaEst.trim());
  let itens = Object.entries(S.state.estoque).sort(porOrd);
  if (q) itens = itens.filter(([, it]) => norm(it.produto).includes(q) || norm(it.obs).includes(q));
  view.innerHTML = `
  <section class="folha">
    <div class="cab">
      <h1>Estoque</h1>
      <label class="busca grande">
        <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input data-k="buscaEst" data-busca="estoque" placeholder="Pesquisar produto" value="${esc(ui.buscaEst)}" autocomplete="off">
        ${q ? '<button data-act="limparEst" aria-label="Limpar pesquisa">×</button>' : ''}
      </label>
    </div>
    <div class="tabela"><table class="grid">
      <colgroup><col><col class="w-q"><col class="w-v"><col class="w-o"><col class="w-x"></colgroup>
      <thead><tr><th>Produto</th><th class="r">Qtd</th><th class="r">Valor</th><th>Obs</th><th></th></tr></thead>
      <tbody>
        ${itens.map(([id, it], i) => `<tr data-id="${id}">
          <td><input data-k="e|${id}|produto" data-ef="produto" data-row="${i}" data-col="0" value="${esc(it.produto)}" class="up strong" autocomplete="off"></td>
          <td><input data-k="e|${id}|qtd" data-ef="qtd" data-row="${i}" data-col="1" value="${esc(it.qtd ?? '')}" inputmode="decimal" class="r" autocomplete="off"></td>
          <td><input data-k="e|${id}|valor" data-ef="valor" data-row="${i}" data-col="2" value="${fmt(it.valor)}" inputmode="decimal" class="r" autocomplete="off"></td>
          <td><input data-k="e|${id}|obs" data-ef="obs" data-row="${i}" data-col="3" value="${esc(it.obs || '')}" class="up" autocomplete="off"></td>
          <td class="c"><button class="del" data-act="delitem" aria-label="Apagar item">×</button></td>
        </tr>`).join('')}
        ${q ? '' : `<tr class="novo"><td><input data-k="novoitem" data-ef="novo" data-row="${itens.length}" data-col="0" placeholder="+ novo produto" class="up" autocomplete="off"></td><td colspan="4"></td></tr>`}
      </tbody>
    </table></div>
    ${q && !itens.length ? '<p class="nota">Nada encontrado.</p>' : ''}
    ${!q && !itens.length ? '<p class="nota">Em breve: importar as notas de compra.</p>' : ''}
  </section>`;
}

function salvarEstoque(el) {
  delete el.dataset.sujo;
  const f = el.dataset.ef;
  if (f === 'novo') {
    const produto = el.value.trim().toUpperCase(); el.value = '';
    if (!produto) return;
    const id = S.uid();
    ui.foco = `e|${id}|qtd`;
    S.setItem(id, { produto, qtd: null, valor: null, obs: '', ord: Date.now() });
    return;
  }
  const id = el.closest('tr').dataset.id;
  const it = S.state.estoque[id]; if (!it) return;
  if (f === 'produto' || f === 'obs') {
    const v = el.value.trim().toUpperCase();
    if (v !== (it[f] || '')) S.setItem(id, { [f]: v });
  } else {
    const v = numero(el.value);
    if (Number.isNaN(v)) { el.value = f === 'valor' ? fmt(it[f]) : (it[f] ?? ''); toast('Número inválido'); return; }
    if (v !== (it[f] ?? null)) S.setItem(id, { [f]: v });
  }
}

// ============ eventos ============
function salvar(el) {
  if (el.dataset.f && el.dataset.f !== 'novo') salvarEntrada(el);
  else if (el.dataset.sf) salvarSaida(el);
  else if (el.dataset.ef) salvarEstoque(el);
  else if (el.dataset.cf) salvarBoleto(el);
}

function mudou(e) {
  const el = e.target;
  if (el.id === 'pick') { if (el.value) { ui.dia = el.value; render(); } return; }
  if (el.dataset.f === 'novo') return; // só cria no Enter/Tab
  if (el.dataset.f || el.dataset.sf || el.dataset.ef || el.dataset.cf) salvar(el);
}

function digitou(e) {
  const el = e.target;
  if (el.dataset.busca === 'entrada') { ui.busca = el.value; render(); return; }
  if (el.dataset.busca === 'estoque') { ui.buscaEst = el.value; render(); return; }
  if (el.dataset.k) el.dataset.sujo = '1';
}

function moverVertical(el, passo) {
  const alvo = view.querySelector(`input[data-row="${+el.dataset.row + passo}"][data-col="${el.dataset.col}"]`)
    || (passo > 0 && view.querySelector(`input[data-row="${+el.dataset.row + passo}"][data-col="0"]`));
  if (!alvo) return false;
  if (el.dataset.sujo) salvar(el);
  alvo.focus(); alvo.select?.();
  return true;
}

function tecla(e) {
  const el = e.target;
  if (el.tagName !== 'INPUT') return;

  if (el.dataset.busca && e.key === 'Escape') {
    if (el.dataset.busca === 'entrada') ui.busca = ''; else ui.buscaEst = '';
    render(); return;
  }
  if (e.key === 'Escape' && el.dataset.k) {
    el.value = el.defaultValue; delete el.dataset.sujo; el.blur(); return;
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && el.dataset.row != null) {
    if (moverVertical(el, e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
    return;
  }
  if (e.key !== 'Enter' && !(e.key === 'Tab' && el.dataset.f === 'novo' && !e.shiftKey && el.value.trim())) return;

  // --- Entrada: fluxo Nº → (Valor) → Obs → nova linha
  if (el.dataset.f) {
    e.preventDefault();
    // render imediato (não espera o próximo quadro) para quem digita rápido
    if (el.dataset.f === 'novo') { novoLancamento(el); render(); return; }
    const res = salvarEntrada(el);
    const tr = el.closest('tr'); const base = `${tr.dataset.d}|${tr.dataset.id}`;
    if (res === 'apagou') ui.foco = ui.busca ? null : 'novo';
    else ui.foco = el.dataset.f === 'n' ? `${base}|v` : el.dataset.f === 'v' ? `${base}|o` : (ui.busca ? null : 'novo');
    if (!ui.foco) el.blur();
    render();
    return;
  }
  // --- Contas: Enter anda para a direita (fornecedor → valor → parcelas) e depois nova linha
  if (el.dataset.cf) {
    e.preventDefault();
    const novo = el.dataset.cf === 'novo';
    salvarBoleto(el);
    if (!novo) {
      const prox = view.querySelector(`input[data-row="${el.dataset.row}"][data-col="${+el.dataset.col + 1}"]`);
      ui.foco = prox ? prox.dataset.k : 'novoboleto';
    }
    render();
    return;
  }
  // --- Saídas / Estoque: Enter salva e desce (como planilha)
  if (el.dataset.sf || el.dataset.ef) {
    e.preventDefault();
    const novo = el.dataset.sf === 'nova' || el.dataset.ef === 'novo';
    salvar(el);
    if (!novo && !moverVertical(el, 1)) el.blur();
    render();
  }
}

function clique(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  const tr = b.closest('tr');
  switch (act) {
    case 'dprev': return irDia(-1);
    case 'dnext': return irDia(1);
    case 'pick': {
      const p = $('#pick');
      try { p.showPicker(); } catch { p.focus(); p.click(); }
      return;
    }
    case 'limpar': ui.busca = ''; ui.foco = 'busca'; return render();
    case 'limparEst': ui.buscaEst = ''; ui.foco = 'buscaEst'; return render();
    case 'ir': ui.dia = b.dataset.d; ui.busca = ''; ui.aba = 'entrada'; window.scrollTo(0, 0); return render();
    case 'pago': {
      const d = tr.dataset.d, id = tr.dataset.id, r = S.state.dias[d]?.rows?.[id]; if (!r) return;
      S.setRow(d, id, { pago: !r.pago });
      if (ui.aba === 'receber') toast(`${r.o || 'Lançamento'} marcado como pago`, 'Desfazer', () => S.setRow(d, id, { pago: false }));
      return;
    }
    case 'del': {
      const d = tr.dataset.d, id = tr.dataset.id, r = S.state.dias[d]?.rows?.[id]; if (!r) return;
      const copia = structuredClone(r);
      S.delRow(d, id);
      toast('Lançamento apagado', 'Desfazer', () => S.setRow(d, id, copia));
      return;
    }
    case 'aprev': ui.ano--; ui.calSel = null; return render();
    case 'anext': ui.ano++; ui.calSel = null; return render();
    case 'mprev': ui.calMes = (ui.calMes + 11) % 12; ui.calSel = null; return render();
    case 'mnext': ui.calMes = (ui.calMes + 1) % 12; ui.calSel = null; return render();
    case 'calDia': ui.calSel = ui.calSel === b.dataset.d ? null : b.dataset.d; return render();
    case 'pagoParc': {
      const id = tr.dataset.id, k = b.dataset.p, bol = S.state.contas[String(ui.ano)]?.itens?.[id];
      if (!bol?.p?.[k]?.d) return;
      S.setBoleto(ui.ano, id, { p: { [k]: { pago: !bol.p[k].pago } } });
      return;
    }
    case 'delboleto': {
      const id = tr.dataset.id, bol = S.state.contas[String(ui.ano)]?.itens?.[id]; if (!bol) return;
      if (!confirm(`Apagar o boleto de "${bol.forn}"?`)) return;
      const copia = structuredClone(bol); const ano = ui.ano;
      S.delBoleto(ano, id);
      toast('Boleto apagado', 'Desfazer', () => S.setBoleto(ano, id, copia));
      return;
    }
    case 'copiar':
      contasDoAno(ui.ano - 1).forEach(([, c], i) => S.setConta(ui.ano, S.uid(), { nome: c.nome, ord: i, m: {} }));
      return;
    case 'delconta': {
      const id = tr.dataset.id, c = S.state.saidas[String(ui.ano)]?.contas?.[id]; if (!c) return;
      if (!confirm(`Apagar a conta "${c.nome}" de ${ui.ano}?`)) return;
      const copia = structuredClone(c); const ano = ui.ano;
      S.delConta(ano, id);
      toast('Conta apagada', 'Desfazer', () => S.setConta(ano, id, copia));
      return;
    }
    case 'delitem': {
      const id = tr.dataset.id, it = S.state.estoque[id]; if (!it) return;
      const copia = structuredClone(it);
      S.delItem(id);
      toast('Item apagado', 'Desfazer', () => S.setItem(id, copia));
    }
  }
}

// ============ aviso (toast) ============
let tt;
function toast(msg, botao, fn) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${botao ? `<button>${esc(botao)}</button>` : ''}`;
  t.hidden = false;
  if (botao) t.querySelector('button').onclick = () => { fn(); t.hidden = true; };
  clearTimeout(tt);
  tt = setTimeout(() => { t.hidden = true; }, botao ? 6000 : 2500);
}

// ============ importar / exportar ============
async function importarArquivo(e) {
  const arq = e.target.files[0]; e.target.value = '';
  if (!arq) return;
  let data;
  try { data = JSON.parse(await arq.text()); } catch { return toast('Arquivo inválido'); }
  if (!Array.isArray(data.entradas)) return toast('Arquivo inválido');
  const nContas = Object.values(data.saidas || {}).reduce((s, l) => s + l.length, 0);
  if (!confirm(`Importar ${data.entradas.length} lançamentos e ${nContas} contas de saída?\n\nTodos entram como PAGOS. Importar de novo não duplica.`)) return;
  toast('Importando…');
  try {
    const n = await S.importar(data);
    toast(`${n} lançamentos importados`);
  } catch (err) { console.error(err); toast('Erro ao importar: ' + err.message); }
}

function carregarScript(src) {
  return new Promise((ok, erro) => {
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = erro;
    document.head.appendChild(s);
  });
}

async function exportar() {
  try {
    if (!window.XLSX) await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  } catch { return toast('Sem internet para gerar o Excel'); }
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const ent = [['DATA', 'HORA', 'Nº', 'PEÇAS/SERVIÇOS', 'VALOR', 'OBS', 'PAGO']];
  Object.keys(S.state.dias).sort().forEach((d) => linhasDoDia(d).forEach(({ r }) =>
    ent.push([fromIso(d), r.h || '', r.n, SERVICOS[r.n]?.nome || r.s || '', r.v, r.o || '', r.pago ? 'SIM' : 'NÃO'])));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(ent, { dateNF: 'dd/mm/yyyy' }), 'ENTRADA');
  Object.keys(S.state.saidas).sort().forEach((ano) => {
    const linhas = [['CONTA', ...MESES]];
    contasDoAno(ano).forEach(([, c]) => linhas.push([c.nome, ...MESES.map((_, j) => c.m?.[j] ?? null)]));
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(linhas), 'SAIDA ' + ano);
  });
  const bols = [['ANO', 'FORNECEDOR', 'VALOR', 'PARCELA 1', 'PAGA', 'PARCELA 2', 'PAGA', 'PARCELA 3', 'PAGA', 'PARCELA 4', 'PAGA']];
  Object.keys(S.state.contas).sort().forEach((ano) => boletosDoAno(ano).forEach(([, b]) =>
    bols.push([Number(ano), b.forn, b.valor, ...[0, 1, 2, 3].flatMap((k) => { const p = b.p?.[k]; return p?.d ? [fromIso(p.d), p.pago ? 'SIM' : 'NÃO'] : [null, null]; })])));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(bols, { dateNF: 'dd/mm/yyyy' }), 'CONTAS');
  const est = [['PRODUTO', 'QTD', 'VALOR', 'OBS']];
  Object.entries(S.state.estoque).sort(porOrd).forEach(([, it]) => est.push([it.produto, it.qtd, it.valor, it.obs]));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(est), 'ESTOQUE');
  X.writeFile(wb, `borges-motos-backup-${hoje()}.xlsx`);
}

// ============ login ============
function vLogin() {
  app.innerHTML = `
  <div class="login">
    <form id="fLogin">
      <div class="brand grande">BORGES <b>MOTOS</b></div>
      <input type="password" id="senha" placeholder="Senha" autocomplete="current-password" required>
      <button class="btn cheio" type="submit">Entrar</button>
      <p class="erro" id="erro"></p>
      <p class="conta">${esc(EMAIL_LOGIN)}</p>
    </form>
  </div>`;
  $('#senha').focus();
  $('#fLogin').onsubmit = async (e) => {
    e.preventDefault();
    const bt = e.target.querySelector('button'); bt.disabled = true; $('#erro').textContent = '';
    try { await S.entrar($('#senha').value); abrir(); }
    catch (err) {
      console.error(err);
      const cod = err.code || '';
      $('#erro').textContent =
        /network/.test(cod) ? 'Sem internet. O primeiro acesso precisa de conexão.'
        : /invalid-credential|wrong-password|user-not-found|invalid-login/.test(cod) ? 'Senha incorreta (ou usuário não existe no Firebase).'
        : /too-many-requests/.test(cod) ? 'Muitas tentativas. Aguarde alguns minutos.'
        : /operation-not-allowed/.test(cod) ? 'Login por e-mail/senha está desativado no Firebase.'
        : /unauthorized-domain|requests-from-referer/.test(cod) ? 'Este endereço não está nos domínios autorizados do Firebase.'
        : 'Erro: ' + (cod || err.message);
      bt.disabled = false;
    }
  };
}

function abrir() {
  casca();
  S.onChange(agendar);
  if (finoPonteiro) ui.foco = 'novo';
  render();
}

// ============ início ============
(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    const r = await S.iniciar();
    if (r === 'login') vLogin(); else abrir();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="login"><p class="erro">Não foi possível iniciar: ${esc(err.message)}</p></div>`;
  }
})();
