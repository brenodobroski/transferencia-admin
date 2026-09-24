/* =========================================================
   Painel ADMIN — Transferências Clima Rio · SUPABASE
   ========================================================= */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://dwmijhwfhocfabwmppcc.supabase.co";
const SUPABASE_KEY = "sb_publishable_FqBFg4MmpasHAZ_RNjobYQ_6FqEQyG1";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const LS_VENDAS = "trf_vendas_casadas_v2"; // vendas casadas ainda locais (por enquanto)
const LIMITE_ARQUIVO = 500 * 1024;

const DIAS_SEMANA = [
  { n: 1, label: "Segunda-feira" }, { n: 2, label: "Terça-feira" },
  { n: 3, label: "Quarta-feira" },  { n: 4, label: "Quinta-feira" },
  { n: 5, label: "Sexta-feira" },   { n: 6, label: "Sábado" },
  { n: 0, label: "Domingo" }
];

/* FILIAIS agora vêm da tabela "filiais" do Supabase.
   O admin gerencia em Configurações → Adicionar filial. */

let modalContexto = null;
let filiais = [];
let transferenciasCache = {};
let vendasCache = {};
let usuarioAtual = null;
let usuariosAprovados = [];      // usuários aprovados (para exigir autorizações)
let autorizacoesPorVenda = {};   // venda_id -> [{id, usuario_id, usuario_nome, status}]
let regrasCache = [];
let diaLiberado = null;
let filtroDiaVenda = "";

/* ---------- Utilitários ---------- */
function $(id) { return document.getElementById(id); }

function mostrarToast(msg) {
  const toast = $("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function nomeLoja(id) {
  const f = filiais.find(x => x.id === id);   // tabela "filiais" do Supabase
  return f ? f.nome : id;
}

function dataHoraBr(iso) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function lerArquivo(inputFile) {
  return new Promise((resolve, reject) => {
    const arquivo = inputFile.files[0];
    if (!arquivo) { reject(new Error("Selecione um arquivo.")); return; }
    if (arquivo.size > LIMITE_ARQUIVO) { reject(new Error("Arquivo muito grande (máx. 500 KB).")); return; }
    const reader = new FileReader();
    reader.onload = () => resolve({ nome: arquivo.name, conteudo: reader.result });
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(arquivo);
  });
}

function baixarArquivo(nome, conteudoDataUrl) {
  const a = document.createElement("a");
  a.href = conteudoDataUrl;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* =========================================================
   DROPDOWNS CUSTOMIZADOS
   ========================================================= */
function toggleDropdown(id) {
  document.querySelectorAll(".custom-dropdown").forEach(drop => {
    const outroId = drop.id.replace("dropdown-", "");
    if (outroId !== id) {
      const l = $("lista-" + outroId);
      const s = drop.querySelector(".seta");
      if (l) l.classList.add("hidden");
      if (s) s.classList.remove("girada");
    }
  });
  const lista = $("lista-" + id);
  const seta = $("dropdown-" + id)?.querySelector(".seta");
  if (lista) lista.classList.toggle("hidden");
  if (seta) seta.classList.toggle("girada");
}

document.addEventListener("click", e => {
  document.querySelectorAll(".custom-dropdown").forEach(drop => {
    if (!drop.contains(e.target)) {
      const id = drop.id.replace("dropdown-", "");
      const l = $("lista-" + id);
      const s = drop.querySelector(".seta");
      if (l) l.classList.add("hidden");
      if (s) s.classList.remove("girada");
    }
  });
});

function preencherDropdown(id, opcoes, valorAtual, placeholder) {
  const ul = $("opcoes-" + id);
  if (!ul) return;
  ul.innerHTML = "";
  opcoes.forEach(op => {
    const li = document.createElement("li");
    li.innerText = op.texto;
    li.setAttribute("data-value", op.valor);
    const selecionado = String(op.valor) === String(valorAtual ?? "");
    li.className = "px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-50" +
      (selecionado ? " bg-blue-50 text-blue-700" : "");
    li.addEventListener("click", () => {
      $("texto-" + id).innerText = op.texto;
      $("input-" + id).value = op.valor;
      $("lista-" + id).classList.add("hidden");
      $("dropdown-" + id)?.querySelector(".seta")?.classList.remove("girada");
      $("input-" + id).dispatchEvent(new Event("change", { bubbles: true }));
    });
    ul.appendChild(li);
  });
  const atual = opcoes.find(o => String(o.valor) === String(valorAtual ?? ""));
  if (atual) {
    $("texto-" + id).innerText = atual.texto;
    $("input-" + id).value = atual.valor;
  } else {
    $("texto-" + id).innerText = placeholder || "— Selecione —";
    $("input-" + id).value = "";
  }
}

/* =========================================================
   LOGIN / LOGOUT
   ========================================================= */
$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("login-botao");
  btn.innerText = "Verificando...";
  btn.disabled = true;
  $("login-erro").classList.add("hidden");

  const email = $("login-email").value.trim();
  const senha = $("login-senha").value;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) throw error;

    const { data: perfil, error: erroPerfil } = await supabase
      .from("usuarios")
      .select("*")
      .eq("id", data.user.id)
      .single();

    if (erroPerfil || !perfil) throw new Error("Usuário sem perfil cadastrado. Contate o suporte.");
    if (perfil.role !== "admin") throw new Error("Este acesso é restrito ao administrador.");

    usuarioAtual = perfil;
    $("perfil-nome").innerText = perfil.nome;
    $("perfil-email").innerText = perfil.email;
    $("perfil-iniciais").innerText = perfil.nome.substring(0, 2).toUpperCase();

    $("tela-login").classList.add("hidden");
    $("app").classList.remove("hidden");
    await atualizarTudo();
    iniciarRealtime();
  } catch (err) {
    await supabase.auth.signOut();
    $("login-erro").innerText = err.message.includes("Invalid login")
      ? "E-mail ou senha incorretos."
      : err.message;
    $("login-erro").classList.remove("hidden");
  } finally {
    btn.innerText = "Entrar";
    btn.disabled = false;
  }
});

async function sairDoSistema() {
  await supabase.auth.signOut();
  if (canalRealtime) {
    supabase.removeChannel(canalRealtime);
    canalRealtime = null; // ⬅ permite reconectar no próximo login
  }
  $("app").classList.add("hidden");
  $("tela-login").classList.remove("hidden");
  $("login-senha").value = "";
}

// Se já tem sessão válida, entra direto
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { data: perfil } = await supabase.from("usuarios").select("*").eq("id", session.user.id).single();
  if (perfil && perfil.role === "admin") {
    usuarioAtual = perfil;
    $("perfil-nome").innerText = perfil.nome;
    $("perfil-email").innerText = perfil.email;
    $("perfil-iniciais").innerText = perfil.nome.substring(0, 2).toUpperCase();
    $("tela-login").classList.add("hidden");
    $("app").classList.remove("hidden");
    await atualizarTudo();
    iniciarRealtime();
  }
})();

/* =========================================================
   SIDEBAR / ABAS
   ========================================================= */
function toggleSidebarDesktop() {
  const sidebar = $("sidebar");
  const main = $("main-content");
  const icon = $("toggle-icon");
  sidebar.classList.toggle("sidebar-collapsed");
  main.classList.toggle("sidebar-collapsed-margin");
  if (sidebar.classList.contains("sidebar-collapsed")) {
    icon.classList.replace("fa-chevron-left", "fa-chevron-right");
  } else {
    icon.classList.replace("fa-chevron-right", "fa-chevron-left");
  }
}

function toggleMobileMenu() {
  $("sidebar").classList.toggle("-translate-x-full");
  $("sidebar-backdrop").classList.toggle("hidden");
}

function mudarAba(aba) {
  ["inicio", "calendario", "sugestoes", "vendas", "config"].forEach(s => {
    $("secao-" + s).classList.add("hidden");
    const btn = $("btn-aba-" + s);
    btn.classList.remove("border-blue-400", "bg-slate-800", "text-slate-200");
    btn.classList.add("border-transparent", "text-slate-400");
  });
  $("secao-" + aba).classList.remove("hidden");
  const btnAtivo = $("btn-aba-" + aba);
  btnAtivo.classList.remove("border-transparent", "text-slate-400");
  btnAtivo.classList.add("border-blue-400", "bg-slate-800", "text-slate-200");

  const titulos = {
    inicio:    ["Início", "Visão geral das transferências entre lojas."],
    calendario:["Calendário", "Controle de sugestões: quando foi feita, quando vence e o que está em atraso."],
    sugestoes: ["Sugestões de Transferência", "Disponível em breve."],
    vendas:    ["Pedidos Avulsos", "Pedidos enviados pelas lojas com evidências — responda com o número do pedido."],
    config:    ["Configurações", "Aprove cadastros, gerencie filiais, regras e o dia liberado para pedidos avulsos."]
  };
  $("titulo-pagina").innerText = titulos[aba][0];
  $("subtitulo-pagina").innerText = titulos[aba][1];

  if (aba === "calendario") renderizarCalendario();

  if (window.innerWidth < 768) toggleMobileMenu();
}

async function atualizarTudo(mostrarAviso = false) {
  await carregarFiliais();
  await Promise.all([
    carregarTransferencias(),
    carregarAprovacoes(),
    carregarUsuarios(),
    carregarVendasSupabase(),
    carregarExtras()
  ]);
  renderizarDropdownFilial();
  renderizarFiltros();
  renderizarInicio();
  renderizarTransferencias();
  renderizarVendas();
  renderizarFiliaisConfig();
  renderizarRegras();
  if (mostrarAviso) mostrarToast("Dados atualizados.");
}

/* =========================================================
   DADOS — SUPABASE
   ========================================================= */
async function carregarExtras() {
  const [{ data: regras }, { data: cfg }] = await Promise.all([
    supabase.from("regras_bloqueio").select("*").order("data_criacao", { ascending: false }),
    supabase.from("configuracoes").select("valor").eq("chave", "dia_pedido_avulso").maybeSingle()
  ]);
  regrasCache = regras || [];
  diaLiberado = cfg?.valor ?? null;
}

async function carregarFiliais() {
  const { data, error } = await supabase.from("filiais").select("*").order("id");
  if (!error) filiais = data || [];
}

/* ⬇ Filiais ATIVAS/INATIVAS — controle visual do admin (localStorage do painel).
   Inativas são ignoradas no calendário, na agenda e nos dropdowns. */
const LS_ATIVAS = "trf_filiais_inativas";
function filiaisInativas() {
  try { return JSON.parse(localStorage.getItem(LS_ATIVAS)) || []; } catch { return []; }
}
function filiaisAtivas() {
  const inativas = filiaisInativas();
  return filiais.filter(f => !inativas.includes(f.id));
}
function toggleFilialAtiva(id, ativa) {
  let inativas = filiaisInativas();
  if (ativa) inativas = inativas.filter(x => x !== id);
  else if (!inativas.includes(id)) inativas.push(id);
  localStorage.setItem(LS_ATIVAS, JSON.stringify(inativas));
  renderizarDropdownFilial();
  renderizarFiltros();
  renderizarInicio();
  renderizarFiliaisConfig();
  mostrarToast(ativa ? "Filial ativada." : "Filial inativada — ficará oculta no calendário e na agenda.");
}

async function carregarTransferencias() {
  const { data, error } = await supabase
    .from("sugestoes")
    .select("*")
    .order("data_envio", { ascending: false });
  transferenciasCache = {};
  (data || []).forEach(t => { transferenciasCache[t.id] = t; });
  window.transferenciasCache = transferenciasCache;
  return data || [];
}

async function carregarAprovacoes() {
  const { data } = await supabase
    .from("usuarios")
    .select("*")
    .eq("role", "pendente")
    .order("nome");
  renderizarAprovacoes(data || []);
}

async function carregarUsuarios() {
  const { data } = await supabase
    .from("usuarios")
    .select("*")
    .neq("role", "pendente")
    .order("nome");
  usuariosAprovados = data || [];
  renderizarUsuarios(data || []);
}

async function carregarVendasSupabase() {
  const { data: vendas } = await supabase
    .from("vendas_casadas")
    .select("*")
    .order("data_envio", { ascending: false });
  const { data: aut } = await supabase
    .from("autorizacoes_venda")
    .select("*");
  autorizacoesPorVenda = {};
  (aut || []).forEach(a => {
    (autorizacoesPorVenda[a.venda_id] = autorizacoesPorVenda[a.venda_id] || []).push(a);
  });
  vendasCache = {};
  (vendas || []).forEach(v => { vendasCache[v.id] = v; });
  window.vendasCache = vendasCache;
  return vendas || [];
}

/* ---------- Realtime ---------- */
let canalRealtime = null;

function iniciarRealtime() {
  // ⬅ Guarda: evita "cannot add callbacks after subscribe()" se for chamado de novo
  if (canalRealtime) return;
  canalRealtime = supabase.channel("admin-realtime");
  canalRealtime
    .on("postgres_changes", { event: "*", schema: "public", table: "sugestoes" }, () => {
      carregarTransferencias().then(() => {
        renderizarInicio();
        renderizarTransferencias();
        if (!$("secao-calendario").classList.contains("hidden")) renderizarCalendario();
      });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "filiais" }, () => atualizarTudo())
    .on("postgres_changes", { event: "*", schema: "public", table: "usuarios" }, () => {
      carregarAprovacoes(); carregarUsuarios();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "vendas_casadas" }, () => {
      carregarVendasSupabase().then(() => { renderizarVendas(); renderizarInicio(); });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "autorizacoes_venda" }, () => {
      carregarVendasSupabase().then(() => { renderizarVendas(); renderizarInicio(); });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "regras_bloqueio" }, () => {
      carregarExtras().then(() => renderizarRegras());
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "configuracoes" }, () => {
      carregarExtras().then(() => renderizarFiltros());
    })
    .subscribe();
}

/* =========================================================
   ABA: INÍCIO
   ========================================================= */
async function renderizarInicio() {
  const transf = await carregarTransferencias();
  await carregarVendasSupabase();
  const vendasPendentes = Object.values(vendasCache).filter(v => v.status === "pendente").length;

  const pendentes = transf.filter(t => t.status === "sugerido").length;
  const respondidas = transf.filter(t => t.status === "respondido").length;
  const pedidos = transf.filter(t => t.status === "pedido").length;

  const card = (numero, rotulo, cor, icone) => `
    <div class="bg-white border border-slate-200 rounded-sm p-5 border-t-4 ${cor}">
      <div class="flex items-center justify-between mb-2">
        <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wide">${rotulo}</span>
        <i class="fas ${icone} text-slate-300"></i>
      </div>
      <span class="text-3xl font-extrabold text-slate-900">${numero}</span>
    </div>`;

  $("cards-resumo").innerHTML =
    card(pendentes, "aguardando loja", "border-t-amber-400", "fa-clock") +
    card(respondidas, "respondidas pela loja", "border-t-sky-400", "fa-reply") +
    card(pedidos, "pedidos registrados", "border-t-green-500", "fa-check-circle") +
    card(vendasPendentes, "pedidos avulsos p/ responder", "border-t-indigo-400", "fa-box-open");

  renderizarAgenda(transf);
  renderizarAtividade(transf, Object.values(vendasCache));
  renderizarCalendario();
}

/* =========================================================
   ABA: CALENDÁRIO — controle de sugestões semanais/quinzenais
   ========================================================= */
let calAno = new Date().getFullYear();
let calMes = new Date().getMonth(); // 0-11

const NOMES_MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function mudarMes(delta) {
  calMes += delta;
  if (calMes < 0) { calMes = 11; calAno--; }
  if (calMes > 11) { calMes = 0; calAno++; }
  renderizarCalendario();
}

/* A data é "dia de sugestão" da filial?
   Se a filial tem ciclo_inicio, conta a partir dele (ex.: quinzenal a partir de 22/09
   → 22/09, 06/10, 20/10...). Senão, cai no cálculo antigo de semanas alternadas. */
function dataDevidaFilial(f, date) {
  if (f.dia_semana === null || f.dia_semana === undefined) return false;
  if (date.getDay() !== f.dia_semana) return false;

  if (f.ciclo_inicio) {
    const DIA = 86400000;
    const inicio = new Date(f.ciclo_inicio + "T00:00:00"); // evita deslocamento de fuso
    const d = new Date(date); d.setHours(0, 0, 0, 0);
    const diff = Math.round((d.getTime() - inicio.getTime()) / DIA);
    if (diff < 0) return false;
    const ciclo = f.periodicidade === "quinzenal" ? 14 : 7;
    return diff % ciclo === 0;
  }

  if (f.periodicidade === "quinzenal") {
    const DIA = 86400000;
    const d = new Date(date); d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7;             // seg=0
    const monday = new Date(d.getTime() - dow * DIA);
    const semanaDesdeEpoch = Math.floor(monday.getTime() / (7 * DIA));
    return semanaDesdeEpoch % 2 === 0;            // semanas alternadas fixas
  }
  return true;                                     // semanal = toda semana
}

/* Sugestão enviada dentro do ciclo que termina em "due" */
function sugestaoDoCiclo(f, due) {
  const ciclo = f.periodicidade === "quinzenal" ? 14 : 7;
  const DIA = 86400000;
  const inicio = new Date(due.getTime() - (ciclo - 1) * DIA);
  const fim = new Date(due.getTime() + DIA - 1);
  return Object.values(transferenciasCache)
    .filter(t => {
      if (t.filial !== f.id) return false;
      const d = new Date(t.data_envio).getTime();
      return d >= inicio.getTime() && d <= fim.getTime();
    })
    .sort((a, b) => new Date(b.data_envio) - new Date(a.data_envio))[0] || null;
}

async function renderizarCalendario() {
  if (! $("cal-grade")) return;
  await carregarTransferencias();

  const ativas = filiaisAtivas();
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  $("cal-titulo").innerText = `${NOMES_MESES[calMes]} de ${calAno}`;

  // ---- Grade do mês ----
  const primeiro = new Date(calAno, calMes, 1);
  const offset = (primeiro.getDay() + 6) % 7; // seg=0
  const diasNoMes = new Date(calAno, calMes + 1, 0).getDate();

  let html = `<div class="grid grid-cols-7 gap-1 text-center text-[10px] font-extrabold text-slate-400 uppercase mb-1">` +
    ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(d => `<span>${d}</span>`).join("") +
    `</div><div class="grid grid-cols-7 gap-1">`;

  for (let i = 0; i < offset; i++) html += "<div></div>";

  for (let dia = 1; dia <= diasNoMes; dia++) {
    const date = new Date(calAno, calMes, dia);
    const ehHoje = date.getTime() === hoje.getTime();
    const chips = ativas
      .filter(f => dataDevidaFilial(f, date))
      .map(f => {
        const s = sugestaoDoCiclo(f, date);
        let cor, prefixo;
        if (s)                       { cor = "bg-green-100 text-green-700 border-green-200"; prefixo = "✓ "; }
        else if (date < hoje)        { cor = "bg-red-100 text-red-600 border-red-200";       prefixo = "✗ "; }
        else                         { cor = "bg-blue-50 text-blue-700 border-blue-200";     prefixo = ""; }
        const title = s
          ? `${f.nome} — sugestão enviada em ${dataHoraBr(s.data_envio)}`
          : `${f.nome} — sugestão não enviada`;
        return `<span title="${escapeHtml(title)}" class="block text-[9px] font-bold px-1 py-0.5 rounded-sm border ${cor}">${prefixo}${escapeHtml(f.id)}</span>`;
      }).join("");

    // ⬅ Indicador de atividade REAL naquele dia: sugestões e pedidos avulsos enviados
    const mesmoDia = (d1, d2) => d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
    const nSugs = Object.values(transferenciasCache).filter(t => mesmoDia(new Date(t.data_envio), date)).length;
    const nVends = Object.values(vendasCache).filter(v => mesmoDia(new Date(v.data_envio), date)).length;
    const htmlEventos = (nSugs || nVends) ? `
      <div class="flex items-center gap-1.5 mt-0.5 text-[9px] font-bold">
        ${nSugs ? `<span class="text-green-600" title="${nSugs} sugestão(ões) enviada(s) neste dia"><i class="fas fa-exchange-alt mr-0.5"></i>${nSugs}</span>` : ""}
        ${nVends ? `<span class="text-indigo-500" title="${nVends} pedido(s) avulso(s) enviado(s) neste dia"><i class="fas fa-box-open mr-0.5"></i>${nVends}</span>` : ""}
      </div>` : "";

    html += `
      <div onclick="abrirModalDia(${calAno}, ${calMes}, ${dia})" title="Ver sugestões e pedidos deste dia" class="min-h-[64px] border ${ehHoje ? "border-blue-400 bg-blue-50/40" : "border-slate-200"} rounded-sm p-1 cursor-pointer hover:border-blue-300 hover:bg-slate-50 transition-colors">
        <span class="text-[10px] font-bold ${ehHoje ? "text-blue-700" : "text-slate-500"}">${dia}</span>
        <div class="flex flex-col gap-0.5 mt-0.5">${chips}</div>
        ${htmlEventos}
      </div>`;
  }
  html += "</div>";
  $("cal-grade").innerHTML = html;
}

function statusSugestaoLoja(filialId) {
  const f = filiais.find(x => x.id === filialId);
  const janelaDias = f?.periodicidade === "quinzenal" ? 15 : 7;
  const limite = new Date();
  limite.setDate(limite.getDate() - janelaDias);

  const recentes = Object.values(transferenciasCache)
    .filter(t => t.filial === filialId && new Date(t.data_envio) >= limite)
    .sort((a, b) => new Date(b.data_envio) - new Date(a.data_envio));

  if (recentes.length === 0) return { txt: "Não enviada", cor: "red" };
  const t = recentes[0];
  if (t.status === "pedido")     return { txt: "Pedido feito", cor: "green" };
  if (t.status === "respondido") return { txt: "Aguardando pedido", cor: "sky" };
  return { txt: "Aguardando loja", cor: "amber" };
}

const CORES_STATUS = {
  red:   { texto: "text-red-600",   bola: "bg-red-500" },
  amber: { texto: "text-amber-700", bola: "bg-amber-400" },
  sky:   { texto: "text-sky-700",   bola: "bg-sky-500" },
  green: { texto: "text-green-700", bola: "bg-green-500" }
};

function renderizarAgenda() {
  const hoje = new Date().getDay();
  let html = "";

  DIAS_SEMANA.forEach(dia => {
    const filiaisDoDia = filiaisAtivas().filter(f => f.dia_semana === dia.n);
    const ehHoje = dia.n === hoje;

    const itens = filiaisDoDia.map(f => {
      const st = statusSugestaoLoja(f.id);
      const cor = CORES_STATUS[st.cor];
      return `
        <div class="flex items-center justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0">
          <div class="min-w-0">
            <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(f.nome)}</p>
            <span class="text-[9px] font-bold uppercase tracking-wide text-slate-400">${f.periodicidade === "quinzenal" ? "Quinzenal" : "Semanal"}</span>
          </div>
          <span class="text-[10px] font-bold ${cor.texto} whitespace-nowrap flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full ${cor.bola} inline-block"></span>${st.txt}
          </span>
        </div>`;
    }).join("");

    html += `
      <div class="border rounded-sm ${ehHoje ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white"}">
        <div class="px-3 py-2 border-b border-slate-100 flex items-center justify-between ${ehHoje ? "bg-blue-100/60" : "bg-slate-50"}">
          <span class="text-[11px] font-extrabold uppercase tracking-wide ${ehHoje ? "text-blue-700" : "text-slate-500"}">${dia.label}</span>
          ${ehHoje ? '<span class="text-[9px] font-bold text-blue-700 bg-white border border-blue-200 px-1.5 py-0.5 rounded-sm uppercase">Hoje</span>' : ""}
        </div>
        <div class="px-3 py-1">
          ${itens || '<p class="text-[11px] text-slate-300 italic py-2">Nenhuma filial</p>'}
        </div>
      </div>`;
  });

  $("agenda-semana").innerHTML = html;
}

function renderizarAtividade(transf, vendas) {
  const eventos = [
    ...transf.map(t => ({ data: t.data_envio, tipo: "transf", item: t })),
    ...vendas.map(v => ({ data: v.data_envio, tipo: "venda", item: v }))
  ].sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 6);

  if (eventos.length === 0) {
    $("atividade-recente").innerHTML =
      '<p class="py-8 text-center text-slate-400 italic text-sm">Nenhuma atividade registrada ainda.</p>';
    return;
  }

  $("atividade-recente").innerHTML = eventos.map(ev => {
    if (ev.tipo === "transf") {
      const t = ev.item;
      const nPed = Array.isArray(t.pedidos) ? t.pedidos.length : 0;
      const statusTxt =
        t.status === "pedido" ? (nPed ? `${nPed} pedido(s) registrado(s)` : "Pedido feito") :
        t.status === "respondido" ? "Planilha devolvida pela loja" : "Aguardando resposta da loja";
      const corTexto =
        t.status === "pedido" ? "text-green-700" :
        t.status === "respondido" ? "text-sky-700" : "text-amber-700";
      const corBorda =
        t.status === "pedido" ? "border-l-green-600" :
        t.status === "respondido" ? "border-l-sky-500" : "border-l-amber-400";
      return `
        <div class="flex justify-between items-center gap-3 py-3 border-b border-slate-100 last:border-0 flex-wrap">
          <div>
            <span class="text-sm font-bold text-slate-800">${nomeLoja(t.filial)}</span>
            <span class="text-[10px] font-bold text-slate-400 uppercase ml-2">Sugestão</span>
            <span class="text-xs text-slate-400 ml-2">${dataHoraBr(t.data_envio)}</span>
          </div>
          <span onclick="abrirModalDetalheTransf('${t.id}')" title="Ver detalhes" class="text-[11px] font-bold uppercase tracking-wide ${corTexto} border-l-4 ${corBorda} pl-2 cursor-pointer hover:opacity-70 transition-opacity">${statusTxt}</span>
        </div>`;
    }
    const v = ev.item;
    const txt =
      v.status === "aprovado" ? "Aprovado" :
      v.status === "negado" ? "Negado" :
      v.status === "negado_permanente" ? "Negado permanente" :
      v.status === "aguardando_autorizacoes" ? "Aguardando autorizações" :
      "Aguardando seu retorno";
    const cor = v.status === "aprovado" ? "text-green-700 border-l-green-600"
      : v.status === "negado_permanente" ? "text-red-800 border-l-red-700"
      : v.status === "negado" ? "text-red-600 border-l-red-500"
      : v.status === "aguardando_autorizacoes" ? "text-amber-700 border-l-amber-400"
      : "text-indigo-700 border-l-indigo-400";
    return `
      <div class="flex justify-between items-center gap-3 py-3 border-b border-slate-100 last:border-0 flex-wrap">
        <div>
          <span class="text-sm font-bold text-slate-800">${escapeHtml(v.usuario_nome || nomeLoja(v.loja_id))}</span>
          <span class="text-[10px] font-bold text-indigo-400 uppercase ml-2">Pedido avulso</span>
          <span class="text-xs text-slate-400 ml-2">${dataHoraBr(v.data_envio)}</span>
        </div>
        <span onclick="abrirModalDetalheVenda('${v.id}')" title="Ver detalhes" class="text-[11px] font-bold uppercase tracking-wide ${cor} border-l-4 pl-2 cursor-pointer hover:opacity-70 transition-opacity">${txt}</span>
      </div>`;
  }).join("");
}

/* =========================================================
   ABA: SUGESTÕES (em breve — código preservado)
   ========================================================= */
function renderizarDropdownFilial() {
  preencherDropdown(
    "sugestao-filial",
    filiaisAtivas().map(f => ({ valor: f.id, texto: f.nome })),   // ⬅ só ativas
    $("input-sugestao-filial").value,
    "— Selecione a filial —"
  );
}

/* ⬇ Modal Nova Sugestão */
function abrirModalSugestao() {
  $("form-sugestao").reset();
  $("input-sugestao-filial").value = "";
  renderizarDropdownFilial();
  $("modal-sugestao").classList.remove("hidden");
}

function fecharModalSugestao() {
  $("modal-sugestao").classList.add("hidden");
}

$("form-sugestao").addEventListener("submit", async e => {
  e.preventDefault();
  const filial = $("input-sugestao-filial").value;
  if (!filial) { mostrarToast("Selecione a filial destino."); return; }

  const btn = $("btn-enviar-sugestao");
  btn.disabled = true;
  btn.innerText = "Enviando...";

  try {
    const arquivo = await lerArquivo($("sugestao-arquivo"));
    const { error } = await supabase.from("sugestoes").insert([{
      filial: filial,
      arquivo_nome: arquivo.nome,
      arquivo_conteudo: arquivo.conteudo,
      obs_sugestao: $("sugestao-obs").value.trim() || null,
      enviado_por: usuarioAtual.nome,
      status: "sugerido",
      baixado_pela_loja: false
    }]);
    if (error) throw error;

    $("form-sugestao").reset();
    $("input-sugestao-filial").value = "";
    fecharModalSugestao();
    await carregarTransferencias();
    renderizarDropdownFilial();
    renderizarInicio();
    renderizarTransferencias();
    mostrarToast(`Sugestão enviada para ${nomeLoja(filial)}.`);
  } catch (err) {
    mostrarToast(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Enviar sugestão';
  }
});

/* ⬇ Filtros das listas (por filial e situação) */
let filtroTransf = "";
let filtroVenda = "";
let filtroStatusTransf = "";

function renderizarFiltros() {
  const ops = [{ valor: "", texto: "Todas as filiais" },
    ...filiaisAtivas().map(f => ({ valor: f.id, texto: f.nome }))];
  preencherDropdown("filtro-transf", ops, filtroTransf);
  preencherDropdown("filtro-vendas", ops, filtroVenda);
  preencherDropdown("filtro-status", [
    { valor: "", texto: "Todas as situações" },
    { valor: "sugerido", texto: "Aguardando loja (pendente de devolução)" },
    { valor: "respondido", texto: "Respondida (aguardando pedido)" },
    { valor: "pedido", texto: "Pedido registrado" }
  ], filtroStatusTransf);
  // ⬅ Filtro por dia da semana (pedidos avulsos) + dia liberado + dropdowns de regra
  preencherDropdown("filtro-dia", [
    { valor: "", texto: "Todos os dias" },
    ...DIAS_SEMANA.map(d => ({ valor: d.n, texto: d.label }))
  ], filtroDiaVenda);
  preencherDropdown("dia-liberacao", DIAS_SEMANA.map(d => ({ valor: d.n, texto: d.label })), diaLiberado, "— Escolha o dia —");
  preencherDropdownsRegra();
}

function preencherDropdownsRegra() {
  const ops = filiais.map(f => ({ valor: f.id, texto: f.nome }));
  preencherDropdown("regra-saida", ops, $("input-regra-saida")?.value, "— Selecione —");
  preencherDropdown("regra-destino", ops, $("input-regra-destino")?.value, "— Selecione —");
}

/* ⬇ Badges reutilizáveis */
function badgeTransf(t) {
  if (t.status === "pedido")
    return `<span class="text-[11px] font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-sm whitespace-nowrap"><i class="fas fa-check-circle mr-1"></i> Finalizado</span>`;
  if (t.status === "respondido")
    return `<span class="text-[11px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2.5 py-1 rounded-sm whitespace-nowrap"><i class="fas fa-reply mr-1"></i> Respondida</span>`;
  return `<span class="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-sm whitespace-nowrap"><i class="fas fa-clock mr-1"></i> Aguardando loja</span>`;
}

function badgeVenda(v, auts = []) {
  const pendentes = auts.filter(a => a.status === "pendente");
  if (v.status === "aprovado")
    return `<span class="text-[11px] font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-sm whitespace-nowrap"><i class="fas fa-check-circle mr-1"></i> Aprovado</span>`;
  if (v.status === "negado_permanente")
    return `<span class="text-[11px] font-bold text-red-800 bg-red-100 border border-red-300 px-2.5 py-1 rounded-sm whitespace-nowrap"><i class="fas fa-ban mr-1"></i> Negado permanente</span>`;
  if (v.status === "negado")
    return `<span class="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-sm whitespace-nowrap"><i class="fas fa-times-circle mr-1"></i> Negado</span>`;
  if (v.status === "aguardando_autorizacoes")
    return `<span class="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-sm whitespace-nowrap"><i class="fas fa-user-shield mr-1"></i> Autorizações ${auts.length - pendentes.length}/${auts.length}</span>`;
  return `<span class="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-sm whitespace-nowrap"><i class="fas fa-inbox mr-1"></i> Aguardando retorno</span>`;
}

/* ⬇ Blocos reutilizáveis do modal de detalhes */
function blocoPedidos(pedidos) {
  return `<div class="rounded-sm border border-green-200 bg-green-50 px-2.5 py-2 flex flex-col gap-0.5">
    ${pedidos.map(p => `<p class="text-[11px] text-green-800"><strong class="font-mono">${escapeHtml(p.numero)}</strong>${p.obs ? ` <span class="text-green-700">— ${escapeHtml(p.obs)}</span>` : ""}</p>`).join("")}
  </div>`;
}

function chipsAutorizacoes(auts) {
  return `<div class="flex items-center gap-1.5 text-[11px] flex-wrap">
    ${auts.map(a => {
      const ok = a.status === "aprovado", rec = a.status === "recusado";
      return `<span title="${rec && a.motivo_recusa ? escapeHtml(a.motivo_recusa) : escapeHtml(a.usuario_nome)}" class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-bold ${ok ? "bg-green-50 text-green-700 border-green-200" : rec ? "bg-red-50 text-red-600 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}">
        <i class="fas ${ok ? "fa-check-circle" : rec ? "fa-times-circle" : "fa-hourglass-half"}"></i>${escapeHtml(a.usuario_nome || "Usuário")}
      </span>`;
    }).join("")}
  </div>`;
}

function linhaDetalhe(rotulo, html) {
  return `<div><span class="text-slate-400 font-bold uppercase text-[9px] tracking-wide block mb-0.5">${rotulo}</span><div class="text-[12px] text-slate-600">${html}</div></div>`;
}
function blocoFase(titulo, linhas) {
  const conteudo = linhas.filter(Boolean).join("");
  if (!conteudo) return "";
  return `<div>
    <span class="text-slate-400 font-bold uppercase text-[9px] tracking-wide block mb-1">${titulo}</span>
    <div class="border border-slate-200 bg-slate-50/60 rounded-sm px-3 py-2 flex flex-col gap-1">${conteudo}</div>
  </div>`;
}


/* ⬇ Modal genérico de detalhes */
function fecharModalDetalhe() {
  $("modal-detalhe").classList.add("hidden");
}

function abrirModalDetalheTransf(id) {
  const t = transferenciasCache[id];
  if (!t) return;
  const pedidosT = Array.isArray(t.pedidos) ? t.pedidos : [];

  let rodape = "";
  let acoes = "";
  if (t.status === "sugerido") {
    acoes = t.baixado_pela_loja
      ? `<span class="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1.5 rounded-sm mr-auto uppercase"><i class="fas fa-download mr-1"></i> Planilha baixada — aguardando resposta</span>`
      : `<span class="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5 rounded-sm mr-auto uppercase"><i class="fas fa-hourglass-half mr-1"></i> Loja ainda não baixou</span>`;
  }
  if (t.status === "respondido") {
    acoes = `<button onclick="fecharModalDetalhe(); abrirModalPedido('transferencia', '${t.id}')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap">
               <i class="fas fa-clipboard-check mr-1"></i> Registrar nº do pedido
             </button>`;
  }
  if (t.status === "pedido") {
    rodape = `<p class="text-[11px] text-slate-500"><strong class="text-green-700">Concluído em:</strong> ${dataHoraBr(t.data_pedido)} &nbsp;·&nbsp; <strong>por:</strong> ${escapeHtml(t.pedido_por || "Admin")}</p>`;
  }

  $("modal-detalhe-conteudo").innerHTML = `
    <h2 class="text-lg font-bold text-slate-800 mb-1">Sugestão de transferência</h2>
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <span class="font-bold text-sm text-slate-800">${nomeLoja(t.filial)}</span>
      ${badgeTransf(t)}
    </div>
    <div class="flex flex-col gap-3">
      ${blocoFase("Sugestão enviada", [
        `<p class="text-[11px] text-slate-500"><i class="fas fa-paperclip text-slate-300 mr-1"></i><a href="#" onclick="event.preventDefault(); baixarTransfPorId('${t.id}', 'sugestao')" class="text-blue-700 font-bold">${escapeHtml(t.arquivo_nome)}</a> <span class="text-slate-400">· ${dataHoraBr(t.data_envio)} por ${escapeHtml(t.enviado_por || "Admin")}</span></p>`,
        t.obs_sugestao ? `<p class="text-[11px] text-slate-500"><i class="fas fa-comment-dots text-blue-300 mr-1"></i>${escapeHtml(t.obs_sugestao)}</p>` : ""
      ])}
      ${blocoFase("Sugestão ajustada pela loja", [
        t.resposta_arquivo_nome
          ? `<p class="text-[11px] text-slate-500"><i class="fas fa-paperclip text-slate-300 mr-1"></i><a href="#" onclick="event.preventDefault(); baixarTransfPorId('${t.id}', 'resposta')" class="text-blue-700 font-bold">${escapeHtml(t.resposta_arquivo_nome)}</a> <span class="text-slate-400">· ${dataHoraBr(t.resposta_data)} por ${escapeHtml(t.respondido_por || "Loja")}</span></p>`
          : `<p class="text-[11px] text-slate-400 italic">Ainda não devolvida</p>`,
        t.resposta_obs ? `<p class="text-[11px] text-slate-500"><i class="fas fa-comment-dots text-sky-400 mr-1"></i>${escapeHtml(t.resposta_obs)}</p>` : ""
      ])}
      ${pedidosT.length ? `<div><span class="text-slate-400 font-bold uppercase text-[9px] tracking-wide block mb-1">Pedidos registrados</span>${blocoPedidos(pedidosT)}</div>` : ""}
      ${rodape}
    </div>
    ${acoes ? `<div class="flex justify-end items-center gap-2 pt-4 flex-wrap">${acoes}</div>` : ""}`;
  $("modal-detalhe").classList.remove("hidden");
}

function abrirModalDetalheVenda(id) {
  const v = vendasCache[id];
  if (!v) return;
  const auts = autorizacoesPorVenda[id] || [];
  const pendentes = auts.filter(a => a.status === "pendente");
  const todosOk = auts.length > 0 && pendentes.length === 0;
  const pedidos = Array.isArray(v.pedidos) ? v.pedidos : [];
  const evidencias = (Array.isArray(v.evidencias) && v.evidencias.length)
    ? v.evidencias
    : (v.arquivo_nome ? [{ nome: v.arquivo_nome, conteudo: v.arquivo_conteudo }] : []);

  let acoes = "";
  if (v.status === "pendente") {
    acoes = `
      <button onclick="fecharModalDetalhe(); abrirModalAutorizacoes('${v.id}')" class="border border-slate-300 text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap">
        <i class="fas fa-user-shield mr-1"></i> Exigir autorizações
      </button>
      <button onclick="fecharModalDetalhe(); abrirModalNegar('${v.id}')" class="border border-red-200 text-red-600 hover:bg-red-50 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap">
        <i class="fas fa-times mr-1"></i> Negar
      </button>
      <button onclick="fecharModalDetalhe(); abrirModalPedido('vendaCasada', '${v.id}')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap">
        <i class="fas fa-clipboard-check mr-1"></i> Aprovar e registrar pedido(s)
      </button>`;
  }
  if (v.status === "aguardando_autorizacoes") {
    acoes = todosOk
      ? `<span class="text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-1.5 rounded-sm mr-auto uppercase"><i class="fas fa-check-double mr-1"></i> Todos autorizaram</span>
         <button onclick="fecharModalDetalhe(); abrirModalNegar('${v.id}')" class="border border-red-200 text-red-600 hover:bg-red-50 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap">
           <i class="fas fa-times mr-1"></i> Negar
         </button>
         <button onclick="fecharModalDetalhe(); abrirModalPedido('vendaCasada', '${v.id}')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap">
           <i class="fas fa-clipboard-check mr-1"></i> Aprovar e registrar pedido(s)
         </button>`
      : `<span class="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5 rounded-sm mr-auto uppercase"><i class="fas fa-lock mr-1"></i> Aprovação bloqueada (${auts.length - pendentes.length}/${auts.length})</span>
         <button onclick="fecharModalDetalhe(); abrirModalNegar('${v.id}')" class="border border-red-200 text-red-600 hover:bg-red-50 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap">
           <i class="fas fa-times mr-1"></i> Negar
         </button>`;
  }

  let rodape = "";
  if (v.status === "aprovado") {
    rodape = `<p class="text-[11px] text-slate-500"><strong class="text-green-700">Concluído em:</strong> ${dataHoraBr(v.data_resposta)} &nbsp;·&nbsp; <strong>por:</strong> ${escapeHtml(v.respondido_por || "Admin")}</p>`;
  }
  if (v.status === "negado" || v.status === "negado_permanente") {
    rodape = `<p class="text-[11px] text-slate-500"><strong class="text-red-600">${v.status === "negado_permanente" ? "Negado permanentemente em:" : "Negado em:"}</strong> ${dataHoraBr(v.data_resposta)} &nbsp;·&nbsp; <strong>por:</strong> ${escapeHtml(v.respondido_por || "Admin")}</p>`;
  }

  const ajustesHtml = (Array.isArray(v.ajustes) && v.ajustes.length) ? `
    <div>
      <span class="text-slate-400 font-bold uppercase text-[9px] tracking-wide block mb-1">Ajustes do lojista</span>
      ${v.ajustes.map(a => `
        <div class="border border-slate-200 bg-white rounded-sm px-2.5 py-2 mb-1">
          <p class="text-[11px] text-slate-400">${escapeHtml(a.por)} · ${dataHoraBr(a.data)}</p>
          ${a.obs ? `<p class="text-[11px] text-slate-600"><i class="fas fa-comment-dots text-sky-400 mr-1"></i>${escapeHtml(a.obs)}</p>` : ""}
          ${(a.evidencias || []).map(ev => `<p class="text-[11px] text-slate-500"><i class="fas fa-paperclip text-slate-300 mr-1"></i><a href="#" onclick="event.preventDefault(); baixarEvidenciaAdmin('${v.id}', ${JSON.stringify(a.data)}, ${(a.evidencias || []).indexOf(ev)})" class="text-blue-700 font-bold">${escapeHtml(ev.nome)}</a></p>`).join("")}
        </div>`).join("")}
    </div>` : "";

  $("modal-detalhe-conteudo").innerHTML = `
    <h2 class="text-lg font-bold text-slate-800 mb-1">Pedido avulso</h2>
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <span class="font-bold text-sm text-slate-800">${escapeHtml(v.usuario_nome || nomeLoja(v.loja_id))}</span>
      ${badgeVenda(v, auts)}
    </div>
    <div class="flex flex-col gap-3">
      ${blocoFase("Pedido enviado", [
        `<div class="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 flex-wrap">
          <span class="bg-white border border-slate-200 px-1.5 py-0.5 rounded-sm">Saída: ${nomeLoja(v.filial_saida)}</span>
          <i class="fas fa-arrow-right text-slate-300 text-[9px]"></i>
          <span class="bg-white border border-slate-200 px-1.5 py-0.5 rounded-sm">Destino: ${nomeLoja(v.filial_destino)}</span>
        </div>`,
        `<p class="text-[11px] text-slate-500"><i class="fas fa-paperclip text-slate-300 mr-1"></i>${evidencias.map((ev, i) => `<a href="#" onclick="event.preventDefault(); baixarEvidencia('${v.id}', ${i})" class="text-blue-700 font-bold">${escapeHtml(ev.nome)}</a>`).join(" · ") || "—"} <span class="text-slate-400">· ${dataHoraBr(v.data_envio)}</span></p>`,
        v.obs ? `<p class="text-[11px] text-slate-500"><i class="fas fa-comment-dots text-indigo-300 mr-1"></i>${escapeHtml(v.obs)}</p>` : ""
      ])}
      ${auts.length ? `<div><span class="text-slate-400 font-bold uppercase text-[9px] tracking-wide block mb-1">Autorizações</span>${chipsAutorizacoes(auts)}</div>` : ""}
      ${pedidos.length ? `<div><span class="text-slate-400 font-bold uppercase text-[9px] tracking-wide block mb-1">Pedidos registrados</span>${blocoPedidos(pedidos)}</div>` : ""}
      ${(v.status === "negado" || v.status === "negado_permanente") && v.motivo_negacao ? `<p class="text-[11px] text-red-600"><i class="fas fa-ban text-red-300 mr-1"></i><strong>${escapeHtml(v.motivo_negacao)}</strong></p>` : ""}
      ${ajustesHtml}
      ${rodape}
    </div>
    ${acoes ? `<div class="flex justify-end items-center gap-2 pt-4 flex-wrap">${acoes}</div>` : ""}`;
  $("modal-detalhe").classList.remove("hidden");
}

/* ⬅ Download de evidências do pedido avulso (admin) */
function baixarEvidencia(vendaId, i) {
  const v = vendasCache[vendaId];
  if (!v) return;
  const lista = (Array.isArray(v.evidencias) && v.evidencias.length)
    ? v.evidencias
    : (v.arquivo_nome ? [{ nome: v.arquivo_nome, conteudo: v.arquivo_conteudo }] : []);
  if (lista[i]) baixarArquivo(lista[i].nome, lista[i].conteudo);
}

/* ⬇ Clique no dia do calendário → sugestões enviadas naquele dia */
function abrirModalDia(ano, mes, dia) {
  const inicio = new Date(ano, mes, dia, 0, 0, 0, 0);
  const fim = new Date(ano, mes, dia, 23, 59, 59, 999);
  const noDia = d => { const x = new Date(d); return x >= inicio && x <= fim; };

  const sugs = Object.values(transferenciasCache)
    .filter(t => noDia(t.data_envio))
    .sort((a, b) => new Date(a.data_envio) - new Date(b.data_envio));
  const vends = Object.values(vendasCache)
    .filter(v => noDia(v.data_envio))
    .sort((a, b) => new Date(a.data_envio) - new Date(b.data_envio));

  $("modal-detalhe-conteudo").innerHTML = `
    <h2 class="text-lg font-bold text-slate-800 mb-1">${inicio.toLocaleDateString("pt-BR")}</h2>
    <p class="text-xs text-slate-500 mb-4">${sugs.length} sugestão(ões) · ${vends.length} pedido(s) avulso(s)</p>

    ${sugs.length ? `
      <p class="text-[10px] font-extrabold uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-green-500"></span> Sugestões
      </p>
      <div class="flex flex-col gap-2 mb-4">
        ${sugs.map(t => `
          <div class="border border-slate-200 rounded-sm p-3 flex justify-between items-center gap-2 flex-wrap hover:bg-slate-50 transition-colors">
            <div class="flex items-baseline gap-2 flex-wrap min-w-0">
              <span class="text-sm font-bold text-slate-800">${nomeLoja(t.filial)}</span>
              <span class="text-[11px] text-slate-400">${new Date(t.data_envio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              ${badgeTransf(t)}
              <button onclick="fecharModalDetalhe(); abrirModalDetalheTransf('${t.id}')" class="border border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-blue-700 px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wide transition-colors whitespace-nowrap">Ver detalhes</button>
            </div>
          </div>`).join("")}
      </div>` : ""}

    ${vends.length ? `
      <p class="text-[10px] font-extrabold uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-indigo-400"></span> Pedidos Avulsos
      </p>
      <div class="flex flex-col gap-2">
        ${vends.map(v => `
          <div class="border border-slate-200 rounded-sm p-3 flex justify-between items-center gap-2 flex-wrap hover:bg-slate-50 transition-colors">
            <div class="flex items-baseline gap-2 flex-wrap min-w-0">
              <span class="text-sm font-bold text-slate-800">${escapeHtml(v.usuario_nome || nomeLoja(v.loja_id))}</span>
              <span class="text-[11px] font-bold text-slate-500">${nomeLoja(v.filial_saida)} → ${nomeLoja(v.filial_destino)}</span>
              <span class="text-[11px] text-slate-400">${new Date(v.data_envio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              ${badgeVenda(v, autorizacoesPorVenda[v.id] || [])}
              <button onclick="fecharModalDetalhe(); abrirModalDetalheVenda('${v.id}')" class="border border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-blue-700 px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wide transition-colors whitespace-nowrap">Ver detalhes</button>
            </div>
          </div>`).join("")}
      </div>` : ""}

    ${!sugs.length && !vends.length ? '<p class="text-xs text-slate-400 italic py-4 text-center">Nada enviado neste dia.</p>' : ""}`;
  $("modal-detalhe").classList.remove("hidden");
}

/* ⬇ Lista RESUMIDA de transferências + filtro por filial */
function renderizarTransferencias() {
  let lista = Object.values(transferenciasCache)
    .sort((a, b) => new Date(b.data_envio) - new Date(a.data_envio));
  if (filtroTransf) lista = lista.filter(t => t.filial === filtroTransf);
  if (filtroStatusTransf) lista = lista.filter(t => t.status === filtroStatusTransf);
  const container = $("lista-transferencias");
  if (!container) return;

  if (lista.length === 0) {
    container.innerHTML = `<p class="py-8 text-center text-slate-400 italic text-sm">${filtroTransf ? "Nenhuma transferência para esta filial." : "Nenhuma transferência enviada ainda."}</p>`;
    return;
  }

  container.innerHTML = lista.map(t => {
    const resumo = [
      `enviada ${dataHoraBr(t.data_envio)}`,
      t.resposta_data ? `· devolvida ${dataHoraBr(t.resposta_data)}` : "",
      Array.isArray(t.pedidos) && t.pedidos.length ? `· ${t.pedidos.length} pedido(s)` : ""
    ].join(" ");

    return `
      <div class="bg-white border border-slate-200 border-l-4 ${
        t.status === "pedido" ? "border-l-green-600" : t.status === "respondido" ? "border-l-sky-500" : "border-l-amber-400"
      } rounded-sm p-3.5 transition-colors hover:bg-slate-50">
        <div class="flex justify-between items-center gap-2 flex-wrap">
          <div class="flex items-baseline gap-2 flex-wrap min-w-0">
            <span class="font-bold text-sm text-slate-800">${nomeLoja(t.filial)}</span>
            <span class="text-[11px] text-slate-400">${resumo}</span>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            ${badgeTransf(t)}
            <button onclick="abrirModalDetalheTransf('${t.id}')" class="border border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-blue-700 px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wide transition-colors whitespace-nowrap">
              <i class="fas fa-search mr-1"></i> Ver detalhes
            </button>
          </div>
        </div>
      </div>`;
  }).join("");
}

function baixarTransfPorId(id, tipo) {
  const t = transferenciasCache[id];
  if (!t) return;
  if (tipo === "sugestao" && t.arquivo_conteudo) baixarArquivo(t.arquivo_nome, t.arquivo_conteudo);
  if (tipo === "resposta" && t.resposta_arquivo_conteudo) baixarArquivo(t.resposta_arquivo_nome, t.resposta_arquivo_conteudo);
}

/* =========================================================
   MODAL: Nº(S) DO PEDIDO (múltiplos, cada um com obs)
   ========================================================= */
function adicionarLinhaPedido(numero = "", obs = "") {
  const container = $("pedidos-linhas");
  const linha = document.createElement("div");
  linha.className = "grid grid-cols-[1fr_1.4fr_auto] gap-2 items-start";
  linha.innerHTML = `
    <input type="text" placeholder="Nº do pedido *" value="${escapeHtml(numero)}"
           class="pedido-numero border border-slate-300 rounded-sm p-2 text-sm outline-none focus:border-blue-500 font-mono">
    <input type="text" placeholder="Observação (conteúdo do pedido)" value="${escapeHtml(obs)}"
           class="pedido-obs border border-slate-300 rounded-sm p-2 text-sm outline-none focus:border-blue-500">
    <button type="button" onclick="this.closest('div').remove()" title="Remover"
            class="text-slate-300 hover:text-red-500 text-lg leading-none px-1 transition-colors">&times;</button>`;
  container.appendChild(linha);
}

function abrirModalPedido(tipo, id) {
  let info = "";
  if (tipo === "transferencia") {
    const t = transferenciasCache[id];
    if (!t || t.status !== "respondido") return;
    info = `${nomeLoja(t.filial)} devolveu a planilha "${t.resposta_arquivo_nome}". Informe um ou mais números de pedido.`;
  } else {
    const v = vendasCache[id];
    if (!v) return;
    if (v.status === "aguardando_autorizacoes") {
      const pendentes = (autorizacoesPorVenda[v.id] || []).filter(a => a.status === "pendente");
      if (pendentes.length) {
        mostrarToast("Ainda há autorizações pendentes — aprovação bloqueada.");
        return;
      }
    }
    info = `${escapeHtml(v.usuario_nome || nomeLoja(v.loja_id))} · pedido avulso (${nomeLoja(v.filial_saida)} → ${nomeLoja(v.filial_destino)}). Informe um ou mais números de pedido.`;
  }
  modalContexto = { tipo, id };
  $("modal-pedido-info").innerText = info;
  $("pedidos-linhas").innerHTML = "";
  adicionarLinhaPedido();
  $("msg-modal-pedido").classList.add("hidden");
  $("modal-pedido").classList.remove("hidden");
}

function fecharModalPedido() {
  $("modal-pedido").classList.add("hidden");
  modalContexto = null;
}

async function confirmarPedido() {
  const linhas = [...document.querySelectorAll("#pedidos-linhas > div")];
  const pedidos = linhas.map(l => ({
    numero: l.querySelector(".pedido-numero").value.trim(),
    obs: l.querySelector(".pedido-obs").value.trim()
  })).filter(p => p.numero);

  if (pedidos.length === 0) {
    $("msg-modal-pedido").innerText = "Informe ao menos um número de pedido.";
    $("msg-modal-pedido").classList.remove("hidden");
    return;
  }

  const btn = $("btn-confirmar-pedido");
  btn.disabled = true;
  btn.innerText = "Registrando...";

  const agora = new Date().toISOString();
  const payload = pedidos.map(p => ({ ...p, data: agora }));

  try {
    if (modalContexto.tipo === "transferencia") {
      const { error } = await supabase.from("sugestoes")
        .update({ status: "pedido", pedidos: payload, data_pedido: agora, pedido_por: usuarioAtual.nome })
        .eq("id", modalContexto.id);
      if (error) throw error;
      await carregarTransferencias();
      renderizarTransferencias();
      renderizarInicio();
    } else {
      const { error } = await supabase.from("vendas_casadas")
        .update({ status: "aprovado", pedidos: payload, data_resposta: agora, respondido_por: usuarioAtual.nome })
        .eq("id", modalContexto.id);
      if (error) throw error;
      await carregarVendasSupabase();
      renderizarVendas();
      renderizarInicio();
    }
    fecharModalPedido();
    mostrarToast(`${pedidos.length} pedido(s) registrado(s) com sucesso.`);
  } catch (err) {
    $("msg-modal-pedido").innerText = "Erro: " + err.message;
    $("msg-modal-pedido").classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.innerText = "Registrar pedido(s)";
  }
}

/* =========================================================
   MODAL: NEGAR PEDIDO AVULSO (motivo obrigatório + opcional permanente)
   ========================================================= */
let vendaNegando = null;

function abrirModalNegar(id) {
  vendaNegando = id;
  const v = vendasCache[id];
  if (!v) return;
  $("modal-negar-info").innerText =
    `${escapeHtml(v.usuario_nome || nomeLoja(v.loja_id))} · pedido avulso (${nomeLoja(v.filial_saida)} → ${nomeLoja(v.filial_destino)}).`;
  $("input-motivo-negacao").value = "";
  $("check-negar-permanente").checked = false;
  $("msg-modal-negar").classList.add("hidden");
  $("modal-negar").classList.remove("hidden");
}

function fecharModalNegar() {
  $("modal-negar").classList.add("hidden");
  vendaNegando = null;
}

async function confirmarNegacao() {
  const motivo = $("input-motivo-negacao").value.trim();
  if (!motivo) {
    $("msg-modal-negar").innerText = "Escreva o motivo da negativa.";
    $("msg-modal-negar").classList.remove("hidden");
    return;
  }
  const permanente = $("check-negar-permanente")?.checked || false;
  const { error } = await supabase.from("vendas_casadas")
    .update({
      status: permanente ? "negado_permanente" : "negado",
      motivo_negacao: motivo,
      data_resposta: new Date().toISOString(),
      respondido_por: usuarioAtual.nome
    })
    .eq("id", vendaNegando);
  if (error) { mostrarToast("Erro: " + error.message); return; }
  fecharModalNegar();
  await carregarVendasSupabase();
  renderizarVendas();
  renderizarInicio();
  mostrarToast(permanente ? "Pedido negado permanentemente." : "Pedido negado — o lojista poderá ajustar e responder.");
}

/* =========================================================
   MODAL: EXIGIR AUTORIZAÇÕES (uma ou mais pessoas)
   ========================================================= */
let vendaAutorizando = null;

function abrirModalAutorizacoes(id) {
  vendaAutorizando = id;
  const container = $("lista-opcoes-autorizacao");
  const jaExigidos = (autorizacoesPorVenda[id] || []).map(a => a.usuario_id);

  // ⬅ Autorização só pode ser exigida de GESTOR ou SUPERVISOR
  container.innerHTML = usuariosAprovados
    .filter(u => ["gestor", "supervisor"].includes(u.role) && !jaExigidos.includes(u.id))
    .map(u => `
      <label class="flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-sm cursor-pointer border border-slate-100">
        <input type="checkbox" class="aut-check w-4 h-4 text-blue-600 rounded border-slate-300 cursor-pointer" value="${u.id}" data-nome="${escapeHtml(u.nome)}">
        <div class="min-w-0">
          <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(u.nome)}</p>
          <p class="text-[10px] text-slate-400">${escapeHtml(u.role)} · filial ${escapeHtml(u.filial)}</p>
        </div>
      </label>`).join("");

  if (!container.innerHTML) {
    container.innerHTML = '<p class="text-xs text-slate-400 italic py-4 text-center">Nenhum usuário disponível para autorizar.</p>';
  }

  $("msg-modal-autorizacoes").classList.add("hidden");
  $("modal-autorizacoes").classList.remove("hidden");
}

function fecharModalAutorizacoes() {
  $("modal-autorizacoes").classList.add("hidden");
  vendaAutorizando = null;
}

async function confirmarAutorizacoes() {
  const selecionados = [...document.querySelectorAll(".aut-check:checked")];
  if (selecionados.length === 0) {
    $("msg-modal-autorizacoes").innerText = "Selecione pelo menos uma pessoa.";
    $("msg-modal-autorizacoes").classList.remove("hidden");
    return;
  }

  const rows = selecionados.map(cb => ({
    venda_id: vendaAutorizando,
    usuario_id: cb.value,
    usuario_nome: cb.dataset.nome,
    exigido_por: usuarioAtual.nome,   // ⬅ fica registrado quem exigiu a autorização
    status: "pendente"
  }));

  const { error } = await supabase.from("autorizacoes_venda").insert(rows);
  if (error) { mostrarToast("Erro: " + error.message); return; }

  // Se a venda estava "pendente", passa a exigir autorizações
  const v = vendasCache[vendaAutorizando];
  if (v && v.status === "pendente") {
    await supabase.from("vendas_casadas")
      .update({ status: "aguardando_autorizacoes" })
      .eq("id", vendaAutorizando);
  }

  fecharModalAutorizacoes();
  await carregarVendasSupabase();
  renderizarVendas();
  renderizarInicio();
  mostrarToast(`${rows.length} autorização(ões) exigida(s).`);
}

/* =========================================================
   ABA: PEDIDOS AVULSOS — lista resumida com filtros
   ========================================================= */
function renderizarVendas() {
  let lista = Object.values(vendasCache)
    .sort((a, b) => new Date(b.data_envio) - new Date(a.data_envio));
  if (filtroVenda) lista = lista.filter(v =>
    v.filial_saida === filtroVenda || v.filial_destino === filtroVenda || v.loja_id === filtroVenda);
  // ⬅ Filtro por dia da semana: filiais agendadas nesse dia
  if (filtroDiaVenda !== "") lista = lista.filter(v => {
    const f = filiais.find(x => x.id === v.loja_id);
    return f && String(f.dia_semana) === String(filtroDiaVenda);
  });
  const container = $("lista-vendas");

  if (lista.length === 0) {
    container.innerHTML = `<p class="py-8 text-center text-slate-400 italic text-sm">${filtroVenda || filtroDiaVenda !== "" ? "Nenhum pedido avulso para este filtro." : "Nenhum pedido avulso recebido."}</p>`;
    return;
  }

  container.innerHTML = lista.map(v => {
    const auts = autorizacoesPorVenda[v.id] || [];
    const corBorda =
      v.status === "aprovado" ? "border-l-green-600" :
      v.status === "negado_permanente" ? "border-l-red-700" :
      v.status === "negado" ? "border-l-red-500" :
      v.status === "aguardando_autorizacoes" ? "border-l-amber-400" : "border-l-indigo-400";

    return `
      <div class="bg-white border border-slate-200 border-l-4 ${corBorda} rounded-sm p-3.5 transition-colors hover:bg-slate-50">
        <div class="flex justify-between items-center gap-2 flex-wrap">
          <div class="flex items-baseline gap-2 flex-wrap min-w-0">
            <span class="font-bold text-sm text-slate-800">${escapeHtml(v.usuario_nome || nomeLoja(v.loja_id))}</span>
            <span class="text-[11px] font-bold text-slate-500">${nomeLoja(v.filial_saida)} → ${nomeLoja(v.filial_destino)}</span>
            <span class="text-[11px] text-slate-400">${dataHoraBr(v.data_envio)}</span>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            ${badgeVenda(v, auts)}
            <button onclick="abrirModalDetalheVenda('${v.id}')" class="border border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-blue-700 px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wide transition-colors whitespace-nowrap">
              <i class="fas fa-search mr-1"></i> Ver detalhes
            </button>
          </div>
        </div>
      </div>`;
  }).join("");
}

function baixarVendaPorId(id) {
  const v = vendasCache[id];
  if (v?.arquivo_conteudo) baixarArquivo(v.arquivo_nome, v.arquivo_conteudo);
}

/* =========================================================
   ABA: CONFIGURAÇÕES — aprovações, filiais, regras e dia liberado
   ========================================================= */
/* ⬇⬇⬇ ROLES DE APROVAÇÃO — EDITE AQUI SE PRECISAR ⬇⬇⬇ */
const ROLES_APROVACAO = ["gestor", "supervisor", "vendedor", "administrativo"];
/* ⬆⬆⬆ (admin só é criado direto no banco de dados) ⬆⬆⬆ */

function renderizarAprovacoes(lista) {
  const container = $("lista-aprovacoes");
  const badge = $("badge-aprovacoes");

  if (lista.length === 0) {
    badge.classList.add("hidden");
    container.innerHTML = '<p class="py-6 text-center text-slate-400 italic text-sm">Nenhum cadastro aguardando aprovação.</p>';
    return;
  }

  badge.classList.remove("hidden");
  badge.innerText = lista.length;

  container.innerHTML = lista.map(u => `
    <div class="py-4 border-b border-slate-100 last:border-0">
      <div class="flex flex-col lg:flex-row lg:items-center gap-3">
        <div class="lg:w-72 min-w-0">
          <p class="text-sm font-bold text-slate-800 truncate">${escapeHtml(u.nome)}</p>
          <p class="text-[11px] text-slate-400 truncate">${escapeHtml(u.email)} · filial: ${escapeHtml(u.filial)}</p>
        </div>
        <div class="flex items-center gap-2 lg:ml-auto flex-wrap">
          <!-- Dropdown: escolher role na aprovação -->
          <div class="relative custom-dropdown w-52" id="dropdown-aprovar-${u.id}">
            <button type="button" onclick="toggleDropdown('aprovar-${u.id}')"
                    class="w-full bg-blue-700 hover:bg-blue-800 text-white rounded-sm py-2 px-3 text-xs font-bold uppercase tracking-wide flex justify-between items-center transition-colors outline-none">
              <span id="texto-aprovar-${u.id}" class="truncate pr-2 text-left">Aprovar como…</span>
              <svg class="seta w-3.5 h-3.5 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </button>
            <div id="lista-aprovar-${u.id}" class="hidden absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-48 overflow-y-auto custom-scrollbar">
              <ul id="opcoes-aprovar-${u.id}" class="py-1 text-xs text-slate-700 font-bold"></ul>
            </div>
            <input type="hidden" id="input-aprovar-${u.id}" value="">
          </div>
          <button onclick="reprovarUsuario('${u.id}')" title="Recusar cadastro"
                  class="border border-slate-200 text-red-600 hover:bg-red-50 px-3 py-2 rounded-sm text-xs font-bold transition-colors whitespace-nowrap">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
    </div>`).join("");

  // Preenche o dropdown de cada usuário pendente com as roles
  lista.forEach(u => {
    preencherDropdown(
      "aprovar-" + u.id,
      ROLES_APROVACAO.map(r => ({ valor: r, texto: r.charAt(0).toUpperCase() + r.slice(1) })),
      "",
      "Aprovar como…"
    );
  });
}

async function aprovarUsuario(id, role) {
  const { error } = await supabase.from("usuarios").update({ role }).eq("id", id);
  if (error) { mostrarToast("Erro: " + error.message); return; }
  mostrarToast(`Usuário aprovado como ${role.toUpperCase()}.`);
  await carregarAprovacoes();
  await carregarUsuarios();
}

async function reprovarUsuario(id) {
  if (!confirm("Recusar este cadastro? A conta de autenticação também será excluída.")) return;
  await supabase.from("usuarios").delete().eq("id", id);
  mostrarToast("Cadastro recusado.");
  await carregarAprovacoes();
}

function renderizarUsuarios(lista) {
  const container = $("lista-usuarios");
  if (lista.length === 0) {
    container.innerHTML = '<p class="py-6 text-center text-slate-400 italic text-sm">Nenhum usuário aprovado ainda.</p>';
    return;
  }
  container.innerHTML = lista.map(u => `
    <div class="flex justify-between items-center gap-3 py-3 border-b border-slate-100 last:border-0 flex-wrap">
      <div>
        <span class="text-sm font-bold text-slate-800">${escapeHtml(u.nome)}</span>
        <span class="text-xs text-slate-400 ml-2">${escapeHtml(u.email)}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-bold uppercase px-2 py-1 rounded-sm ${u.role === "admin" ? "bg-purple-50 text-purple-700 border border-purple-200" : "bg-slate-100 text-slate-600 border border-slate-200"}">${u.role}</span>
        <span class="text-[11px] text-slate-400">filial ${escapeHtml(u.filial)}</span>
      </div>
    </div>`).join("");
}

/* ----- Filiais ----- */
$("form-filial").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("msg-nova-filial");
  const id = $("filial-id").value.trim().toLowerCase().replace(/\s+/g, "");
  const nome = $("filial-nome").value.trim();

  if (filiais.some(f => f.id === id)) {
    msg.innerText = "Já existe uma filial com esse código.";
    msg.classList.remove("hidden");
    return;
  }

  const { error } = await supabase.from("filiais")
    .insert([{ id, nome, periodicidade: "semanal", dia_semana: null }]);
  if (error) { msg.innerText = "Erro: " + error.message; msg.classList.remove("hidden"); return; }

  $("form-filial").reset();
  msg.classList.add("hidden");
  await carregarFiliais();
  renderizarDropdownFilial();
  renderizarInicio();
  renderizarFiliaisConfig();
  mostrarToast(`Filial "${nome}" adicionada. Defina a agenda abaixo.`);
});

function renderizarFiliaisConfig() {
  const container = $("lista-filiais");

  if (filiais.length === 0) {
    container.innerHTML = '<p class="py-6 text-center text-slate-400 italic text-sm">Nenhuma filial cadastrada.</p>';
    return;
  }

  container.innerHTML = filiais.map(f => `
    <div class="py-4 border-b border-slate-100 last:border-0">
      <div class="flex flex-col lg:flex-row lg:items-end gap-3">
        <div class="lg:w-64 min-w-0">
          <p class="text-sm font-bold text-slate-800 truncate">${escapeHtml(f.id)}</p>
          <p class="text-[11px] text-slate-500 truncate">${escapeHtml(f.nome)}</p>
          <label class="inline-flex items-center gap-2 mt-1.5 cursor-pointer select-none" title="Filial inativa fica oculta no calendário e na agenda">
            <input type="checkbox" class="peer sr-only" ${filiaisInativas().includes(f.id) ? "" : "checked"} onchange="toggleFilialAtiva('${escapeHtml(f.id)}', this.checked)">
            <span class="w-8 h-4 rounded-full bg-slate-300 peer-checked:bg-green-500 relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-3 after:h-3 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-4"></span>
            <span class="text-[10px] font-bold uppercase text-slate-400 peer-checked:text-green-600">Ativa</span>
          </label>
        </div>
        <div class="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1">Periodicidade</label>
            <div class="relative custom-dropdown" id="dropdown-periodicidade-${escapeHtml(f.id)}">
            <button type="button" onclick="toggleDropdown('periodicidade-${escapeHtml(f.id)}')"
                    class="w-full bg-white border border-slate-300 rounded-sm py-2 px-3 text-xs font-bold text-slate-700 flex justify-between items-center hover:border-blue-400 transition-all outline-none">
              <span id="texto-periodicidade-${escapeHtml(f.id)}" class="truncate pr-2 text-left"></span>
              <svg class="seta w-3.5 h-3.5 text-slate-500 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </button>
            <div id="lista-periodicidade-${escapeHtml(f.id)}" class="hidden absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-48 overflow-y-auto custom-scrollbar">
              <ul id="opcoes-periodicidade-${escapeHtml(f.id)}" class="py-1 text-xs text-slate-700 font-bold"></ul>
            </div>
            <input type="hidden" id="input-periodicidade-${escapeHtml(f.id)}" value="">
            </div>
          </div>
          <div>
            <label class="block text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1">Dia da semana</label>
            <div class="relative custom-dropdown" id="dropdown-diadasemana-${escapeHtml(f.id)}">
            <button type="button" onclick="toggleDropdown('diadasemana-${escapeHtml(f.id)}')"
                    class="w-full bg-white border border-slate-300 rounded-sm py-2 px-3 text-xs font-bold text-slate-700 flex justify-between items-center hover:border-blue-400 transition-all outline-none">
              <span id="texto-diadasemana-${escapeHtml(f.id)}" class="truncate pr-2 text-left"></span>
              <svg class="seta w-3.5 h-3.5 text-slate-500 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </button>
            <div id="lista-diadasemana-${escapeHtml(f.id)}" class="hidden absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-48 overflow-y-auto custom-scrollbar">
              <ul id="opcoes-diadasemana-${escapeHtml(f.id)}" class="py-1 text-xs text-slate-700 font-bold"></ul>
            </div>
            <input type="hidden" id="input-diadasemana-${escapeHtml(f.id)}" value="">
            </div>
          </div>

          <!-- Início do ciclo (a partir de quando o calendário conta) -->
          <div>
            <label class="block text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1">Início do ciclo</label>
            <input type="date" id="ciclo-inicio-${escapeHtml(f.id)}" value="${f.ciclo_inicio || ""}"
                   class="w-full bg-white border border-slate-300 rounded-sm py-2 px-3 text-xs font-bold text-slate-700 outline-none hover:border-blue-400 focus:border-blue-500 transition-all">
          </div>
        </div>
        <div class="flex gap-2">
          <button onclick="abrirModalEditarFilial('${escapeHtml(f.id)}')"
                  class="border border-slate-300 text-slate-600 hover:bg-slate-100 px-3 py-2 rounded-sm text-xs font-bold transition-colors whitespace-nowrap">
            <i class="fas fa-pen mr-1"></i> Editar
          </button>
          <button onclick="excluirFilial('${escapeHtml(f.id)}')"
                  class="border border-slate-200 text-red-600 hover:bg-red-50 px-3 py-2 rounded-sm text-xs font-bold transition-colors whitespace-nowrap">
            <i class="fas fa-trash mr-1"></i> Excluir
          </button>
        </div>
      </div>
    </div>`).join("");

  filiais.forEach(f => {
    preencherDropdown(
      "periodicidade-" + f.id,
      [{ valor: "semanal", texto: "Semanal" }, { valor: "quinzenal", texto: "Quinzenal" }],
      f.periodicidade
    );
    preencherDropdown(
      "diadasemana-" + f.id,
      DIAS_SEMANA.map(d => ({ valor: d.n, texto: d.label })),
      f.dia_semana,
      "— Dia da semana —"
    );
  });
}

document.addEventListener("change", async e => {
  const alvo = e.target;
  if (!alvo.id) return;

  let filialId = null, campo = null;
  if (alvo.id.startsWith("input-periodicidade-")) {
    filialId = alvo.id.replace("input-periodicidade-", "");
    campo = "periodicidade";
  } else if (alvo.id.startsWith("input-diadasemana-")) {
    filialId = alvo.id.replace("input-diadasemana-", "");
    campo = "dia_semana";
  } else if (alvo.id.startsWith("ciclo-inicio-")) {
    filialId = alvo.id.replace("ciclo-inicio-", "");
    campo = "ciclo_inicio";
  } else if (alvo.id.startsWith("input-aprovar-")) {
    // ⬅ Aprovação: o valor do dropdown é a role escolhida
    const userId = alvo.id.replace("input-aprovar-", "");
    if (alvo.value) aprovarUsuario(userId, alvo.value);
    return;
  } else if (alvo.id === "input-filtro-transf") {
    filtroTransf = alvo.value;
    renderizarTransferencias();
    return;
  } else if (alvo.id === "input-filtro-status") {
    filtroStatusTransf = alvo.value;
    renderizarTransferencias();
    return;
  } else if (alvo.id === "input-filtro-vendas") {
    filtroVenda = alvo.value;
    renderizarVendas();
    return;
  } else if (alvo.id === "input-filtro-dia") {
    // ⬅ Filtro por dia da semana (pedidos avulsos)
    filtroDiaVenda = alvo.value;
    renderizarVendas();
    return;
  } else if (alvo.id === "input-dia-liberacao") {
    // ⬅ Dia liberado para pedidos avulsos
    await salvarDiaLiberacao(alvo.value);
    return;
  }
  if (!filialId || !campo) return;

  const valor = campo === "dia_semana"
    ? (alvo.value === "" ? null : parseInt(alvo.value))
    : campo === "ciclo_inicio"
      ? (alvo.value || null)
      : alvo.value;

  const { error } = await supabase.from("filiais").update({ [campo]: valor }).eq("id", filialId);
  if (error) { mostrarToast("Erro ao salvar: " + error.message); return; }
  await carregarFiliais();
  renderizarInicio();
  mostrarToast("Agenda atualizada.");
});

/* ⬇ Modal Editar Filial */
let filialEditando = null;

function abrirModalEditarFilial(id) {
  const f = filiais.find(x => x.id === id);
  if (!f) return;
  filialEditando = id;
  $("modal-editar-filial-info").innerText = `Código: ${f.id}`;
  $("edit-filial-nome").value = f.nome;
  $("msg-editar-filial").classList.add("hidden");
  $("modal-editar-filial").classList.remove("hidden");
  $("edit-filial-nome").focus();
}

function fecharModalEditarFilial() {
  $("modal-editar-filial").classList.add("hidden");
  filialEditando = null;
}

async function confirmarEdicaoFilial() {
  const nome = $("edit-filial-nome").value.trim();
  if (!nome) {
    $("msg-editar-filial").innerText = "O nome da filial não pode ficar vazio.";
    $("msg-editar-filial").classList.remove("hidden");
    return;
  }
  const { error } = await supabase.from("filiais")
    .update({ nome })
    .eq("id", filialEditando);
  if (error) { mostrarToast("Erro: " + error.message); return; }
  fecharModalEditarFilial();
  await carregarFiliais();
  renderizarDropdownFilial();
  renderizarFiltros();
  renderizarInicio();
  renderizarFiliaisConfig();
  mostrarToast("Filial renomeada com sucesso.");
}

async function excluirFilial(id) {
  const f = filiais.find(x => x.id === id);
  if (!f) return;
  if (!confirm(`Excluir a filial "${f.nome}"?`)) return;
  const { error } = await supabase.from("filiais").delete().eq("id", id);
  if (error) { mostrarToast("Erro: " + error.message); return; }
  await carregarFiliais();
  renderizarDropdownFilial();
  renderizarInicio();
  renderizarFiliaisConfig();
  mostrarToast(`Filial "${f.nome}" excluída.`);
}

/* =========================================================
   REGRAS DE BLOQUEIO + DIA LIBERADO
   ========================================================= */
async function salvarDiaLiberacao(valor) {
  diaLiberado = valor || null;
  const { error } = await supabase.from("configuracoes")
    .upsert({ chave: "dia_pedido_avulso", valor: valor });
  if (error) { mostrarToast("Erro ao salvar: " + error.message); return; }
  mostrarToast("Dia liberado atualizado.");
}

function renderizarRegras() {
  const container = $("lista-regras");
  if (!container) return;
  if (!regrasCache.length) {
    container.innerHTML = '<p class="py-4 text-center text-slate-400 italic text-xs">Nenhuma regra criada.</p>';
    return;
  }
  container.innerHTML = regrasCache.map(r => `
    <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap text-xs font-bold text-slate-700">
        <span class="bg-slate-100 border border-slate-200 px-2 py-1 rounded-sm">${nomeLoja(r.filial_saida)}</span>
        <i class="fas fa-arrow-right text-slate-300"></i>
        <span class="bg-slate-100 border border-slate-200 px-2 py-1 rounded-sm">${nomeLoja(r.filial_destino)}</span>
        ${r.motivo ? `<span class="font-normal text-slate-400">· ${escapeHtml(r.motivo)}</span>` : ""}
      </div>
      <div class="flex gap-2">
        <button onclick="editarRegra('${r.id}')" class="border border-slate-300 text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-sm text-xs font-bold transition-colors whitespace-nowrap">
          <i class="fas fa-pen mr-1"></i> Editar
        </button>
        <button onclick="excluirRegra('${r.id}')" class="border border-slate-200 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-sm text-xs font-bold transition-colors whitespace-nowrap">
          <i class="fas fa-trash mr-1"></i> Excluir
        </button>
      </div>
    </div>`).join("");
}

let regraEditando = null;

$("form-regra").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("msg-regra");
  const saida = $("input-regra-saida").value;
  const destino = $("input-regra-destino").value;
  const motivo = $("regra-motivo").value.trim() || null;

  if (!saida || !destino) { msg.innerText = "Selecione as duas filiais."; msg.classList.remove("hidden"); return; }
  if (saida === destino) { msg.innerText = "Saída e destino não podem ser iguais."; msg.classList.remove("hidden"); return; }

  let error;
  if (regraEditando) {
    ({ error } = await supabase.from("regras_bloqueio")
      .update({ filial_saida: saida, filial_destino: destino, motivo })
      .eq("id", regraEditando));
  } else {
    ({ error } = await supabase.from("regras_bloqueio")
      .insert([{ filial_saida: saida, filial_destino: destino, motivo }]));
  }
  if (error) { msg.innerText = "Erro: " + error.message; msg.classList.remove("hidden"); return; }

  regraEditando = null;
  $("btn-regra").innerHTML = '<i class="fas fa-plus mr-2"></i> Criar regra';
  $("form-regra").reset();
  $("input-regra-saida").value = "";
  $("input-regra-destino").value = "";
  preencherDropdownsRegra();
  msg.classList.add("hidden");
  await carregarExtras();
  renderizarRegras();
  mostrarToast("Regra salva.");
});

function editarRegra(id) {
  const r = regrasCache.find(x => x.id === id);
  if (!r) return;
  regraEditando = id;
  $("regra-motivo").value = r.motivo || "";
  $("btn-regra").innerHTML = '<i class="fas fa-save mr-2"></i> Salvar alteração';
  const ops = filiais.map(f => ({ valor: f.id, texto: f.nome }));
  preencherDropdown("regra-saida", ops, r.filial_saida, "— Selecione —");
  preencherDropdown("regra-destino", ops, r.filial_destino, "— Selecione —");
}

async function excluirRegra(id) {
  if (!confirm("Excluir esta regra de bloqueio?")) return;
  await supabase.from("regras_bloqueio").delete().eq("id", id);
  await carregarExtras();
  renderizarRegras();
  mostrarToast("Regra excluída.");
}

/* ---------- Expõe funções usadas nos onclick inline ---------- */
Object.assign(window, {
  toggleDropdown, toggleSidebarDesktop, toggleMobileMenu, mudarAba,
  atualizarTudo, sairDoSistema, abrirModalPedido, fecharModalPedido,
  confirmarPedido, adicionarLinhaPedido, baixarTransfPorId, baixarVendaPorId, baixarEvidencia,
  aprovarUsuario, reprovarUsuario, excluirFilial,
  abrirModalNegar, fecharModalNegar, confirmarNegacao,
  abrirModalAutorizacoes, fecharModalAutorizacoes, confirmarAutorizacoes,
  mudarMes,
  fecharModalDetalhe, abrirModalDetalheTransf, abrirModalDetalheVenda, abrirModalDia,
  abrirModalSugestao, fecharModalSugestao,
  abrirModalEditarFilial, fecharModalEditarFilial, confirmarEdicaoFilial,
  toggleFilialAtiva,
  editarRegra, excluirRegra
});