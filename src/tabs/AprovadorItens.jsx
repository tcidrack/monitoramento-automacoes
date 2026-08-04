import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import { buscarPaginado } from "../lib/supabaseFetch";
import { dataHojeBR, formatarDuracao } from "../lib/dateUtils";
import { usePollingFetch } from "../hooks/usePollingFetch";

// 3.704 linhas na tabela inteira — 5.000 cobre tudo que existe, nunca trunca.
const MAX_LINHAS = 5000;

function formatarDataHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    `${String(d.getDate()).padStart(2, "0")}/` +
    `${String(d.getMonth() + 1).padStart(2, "0")}/` +
    `${d.getFullYear()} ` +
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  );
}

function inicioDoDiaISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function AprovadorItens({ tema, cores }) {
  const ITENS_POR_PAGINA = 20;
  const [pagina, setPagina] = useState(1);
  const [buscaLote, setBuscaLote] = useState("");
  const [buscaPrestador, setBuscaPrestador] = useState("");
  const [buscaCliente, setBuscaCliente] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("Todos");
  const [dataInicio, setDataInicio] = useState(dataHojeBR);
  const [dataFim, setDataFim] = useState("");
  const [prestadoresUnicos, setPrestadoresUnicos] = useState([]);
  const [clientesUnicos, setClientesUnicos] = useState([]);
  const [totais, setTotais] = useState({ aprov: 0, glos: 0, erro: 0, tmin: 0, tseg: 0, nlotes: 0 });

  const accentColor = tema === "escuro" ? "#FFCB05" : "#FF0073";
  const COLOR_APROV = tema === "escuro" ? "#34d399" : "#059669";
  const COLOR_GLOS = tema === "escuro" ? "#fbbf24" : "#d97706";
  const COLOR_ERRO = tema === "escuro" ? "#ff0000" : "#dc2626";

  const fetchAprovador = useCallback(async (signal) => {
    // id como critério de desempate: sem ordem total, duas linhas de mesmo
    // instante poderiam pular ou repetir entre as páginas do .range().
    const montarQuery = () => {
      let q = supabase
        .from("aprovador_itens")
        .select("id, cliente, prestador, numero_lote, qtd_itens_aprovados, qtd_itens_glosados, qtd_itens_erro, tempo_gasto_minutos, tempo_gasto_segundos, created_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (dataInicio) {
        q = q.gte("created_at", dataInicio);
      } else if (!dataFim) {
        q = q.gte("created_at", inicioDoDiaISO());
      }
      if (dataFim) q = q.lte("created_at", dataFim + "T23:59:59");
      if (buscaPrestador) q = q.eq("prestador", buscaPrestador);
      if (buscaCliente) q = q.eq("cliente", buscaCliente);
      if (filtroStatus === "Aprovados") q = q.gt("qtd_itens_aprovados", 0);
      else if (filtroStatus === "Glosados") q = q.gt("qtd_itens_glosados", 0);
      else if (filtroStatus === "Erro do sistema") q = q.gt("qtd_itens_erro", 0);
      if (signal) q = q.abortSignal(signal);
      return q;
    };
    return buscarPaginado(montarQuery, MAX_LINHAS);
  }, [dataInicio, dataFim, buscaPrestador, buscaCliente, filtroStatus]);

  const { data: dados, loading } = usePollingFetch(
    fetchAprovador,
    120000,
    [dataInicio, dataFim, buscaPrestador, buscaCliente, filtroStatus]
  );

  useEffect(() => {
    const KEY = "aprovador_dropdowns_cache";
    const cached = localStorage.getItem(KEY);
    if (cached) {
      try {
        const { ts, prest, cli } = JSON.parse(cached);
        if (Date.now() - ts < 24 * 60 * 60 * 1000) {
          setPrestadoresUnicos(prest);
          setClientesUnicos(cli);
          return;
        }
      } catch { /* cache inválido */ }
    }
    let ativo = true;
    (async () => {
      const { data, error } = await supabase
        .from("aprovador_itens")
        .select("cliente, prestador")
        .limit(5000);
      if (!ativo || error) return;
      const prest = [...new Set((data || []).map((r) => r.prestador).filter(Boolean))].sort();
      const cli = [...new Set((data || []).map((r) => r.cliente).filter(Boolean))].sort();
      setPrestadoresUnicos(prest);
      setClientesUnicos(cli);
      localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), prest, cli }));
    })();
    return () => { ativo = false; };
  }, []);

  // Acumula clientes/prestadores novos vistos nos dados (estado + cache), pra não
  // sumirem do filtro ao trocar de cliente. Sem consulta extra — usa os dados já carregados.
  useEffect(() => {
    if (!dados.length) return;
    const cli = dados.map((r) => r.cliente).filter(Boolean);
    const prest = dados.map((r) => r.prestador).filter(Boolean);
    const mergedCli = [...new Set([...clientesUnicos, ...cli])].sort();
    const mergedPrest = [...new Set([...prestadoresUnicos, ...prest])].sort();
    const cliMudou = mergedCli.length !== clientesUnicos.length;
    const prestMudou = mergedPrest.length !== prestadoresUnicos.length;
    if (!cliMudou && !prestMudou) return;
    if (cliMudou) setClientesUnicos(mergedCli);
    if (prestMudou) setPrestadoresUnicos(mergedPrest);
    const KEY = "aprovador_dropdowns_cache";
    let ts = Date.now();
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || "null");
      if (c?.ts) ts = c.ts;
    } catch { /* cache inválido */ }
    localStorage.setItem(KEY, JSON.stringify({ ts, prest: mergedPrest, cli: mergedCli }));
  }, [dados, clientesUnicos, prestadoresUnicos]);

  useEffect(() => {
    let ativo = true;
    (async () => {
      let q = supabase
        .from("aprovador_itens")
        .select("aprov:qtd_itens_aprovados.sum(), glos:qtd_itens_glosados.sum(), erro:qtd_itens_erro.sum(), tmin:tempo_gasto_minutos.sum(), tseg:tempo_gasto_segundos.sum(), nlotes:id.count()");
      if (dataInicio) q = q.gte("created_at", dataInicio);
      if (dataFim) q = q.lte("created_at", dataFim + "T23:59:59");
      if (buscaPrestador) q = q.eq("prestador", buscaPrestador);
      if (buscaCliente) q = q.eq("cliente", buscaCliente);
      if (filtroStatus === "Aprovados") q = q.gt("qtd_itens_aprovados", 0);
      else if (filtroStatus === "Glosados") q = q.gt("qtd_itens_glosados", 0);
      else if (filtroStatus === "Erro do sistema") q = q.gt("qtd_itens_erro", 0);
      const { data, error } = await q;
      if (!ativo || error) return;
      const t = data?.[0] || {};
      setTotais({
        aprov: t.aprov || 0,
        glos: t.glos || 0,
        erro: t.erro || 0,
        tmin: t.tmin || 0,
        tseg: t.tseg || 0,
        nlotes: t.nlotes || 0,
      });
    })();
    return () => { ativo = false; };
  }, [dataInicio, dataFim, buscaPrestador, buscaCliente, filtroStatus]);

  let filtrados = dados;
  if (buscaLote.trim()) {
    filtrados = filtrados.filter((r) =>
      (r.numero_lote || "").toLowerCase().includes(buscaLote.trim().toLowerCase())
    );
  }


  const totalAprov = totais.aprov;
  const totalGlos = totais.glos;
  const totalErro = totais.erro;
  const totalBase = totalAprov + totalGlos;
  const totalGeral = totalBase + totalErro;
  const taxaAprovGlos = totalGeral > 0 ? ((totalBase / totalGeral) * 100).toFixed(1) : "0";

  const totalMin = totais.tmin;
  const totalSeg = totais.tseg;
  const tempoTotal = totalMin + Math.floor(totalSeg / 60);
  const avgTempo = totais.nlotes > 0 ? (tempoTotal / totais.nlotes).toFixed(1) : "0";
  const tempoTrabalhadoFmt = formatarDuracao(tempoTotal);

  const chartData = [
    { nome: "Aprovados", valor: totalAprov },
    { nome: "Glosados", valor: totalGlos },
    { nome: "Erro", valor: totalErro },
  ];

  const totalPaginas = Math.ceil(filtrados.length / ITENS_POR_PAGINA);
  const paginaSegura = Math.min(Math.max(1, pagina), Math.max(1, totalPaginas));
  const inicio = (paginaSegura - 1) * ITENS_POR_PAGINA;
  const paginaDados = filtrados.slice(inicio, inicio + ITENS_POR_PAGINA);

  const PAGINAS_VISIVEIS = 5;
  const metade = Math.floor(PAGINAS_VISIVEIS / 2);
  let inicioPaginas = Math.max(1, paginaSegura - metade);
  let fimPaginas = Math.min(totalPaginas, inicioPaginas + PAGINAS_VISIVEIS - 1);
  if (fimPaginas - inicioPaginas + 1 < PAGINAS_VISIVEIS) {
    inicioPaginas = Math.max(1, fimPaginas - PAGINAS_VISIVEIS + 1);
  }
  const paginasVisiveis = Array.from(
    { length: fimPaginas - inicioPaginas + 1 },
    (_, i) => inicioPaginas + i
  );

  function irParaPagina(p) {
    setPagina(Math.min(Math.max(1, p), totalPaginas));
  }

  useEffect(() => { setPagina(1); }, [buscaLote, buscaPrestador, buscaCliente, filtroStatus, dataInicio, dataFim]);

  function exportarExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["", "", "", "Total aprovados", totalAprov],
      ["", "", "", "Total glosados", totalGlos],
      ["", "", "", "Total erros", totalErro],
      ["", "", "", "Taxa de aprovação", taxaAprovGlos + "%"],
      ["", "", "", "Tempo médio/lote", avgTempo + " min"],
      [],
      ["Cliente", "Prestador", "Nº do Lote", "Aprovados", "Glosados", "Erro", "Tempo (min)", "Tempo (seg)", "Data"],
      ...filtrados.map((r) => [
        r.cliente || "",
        r.prestador,
        r.numero_lote,
        r.qtd_itens_aprovados ?? 0,
        r.qtd_itens_glosados ?? 0,
        r.qtd_itens_erro ?? 0,
        r.tempo_gasto_minutos ?? 0,
        r.tempo_gasto_segundos ?? 0,
        formatarDataHora(r.created_at),
      ]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Aprovador de Itens");
    XLSX.writeFile(wb, "aprovador_itens.xlsx");
  }

  return (
    <>
      {/* CARDS */}
      <div className="cards">
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer'  }}>
          <h3>Total de Lotes</h3>
          <p>{totais.nlotes.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>no período filtrado</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer'  }}>
          <h3>Itens Aprovados</h3>
          <p style={{ color: COLOR_APROV }}>{totalAprov.toLocaleString("pt-BR")}</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer'  }}>
          <h3>Itens Glosados</h3>
          <p style={{ color: COLOR_GLOS }}>{totalGlos.toLocaleString("pt-BR")}</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer'  }}>
          <h3>Itens com Erro</h3>
          <p style={{ color: COLOR_ERRO }}>{totalErro.toLocaleString("pt-BR")}</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer'  }}>
          <h3>Taxa de Aprovados/Glosados</h3>
          <p>{taxaAprovGlos}%</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>{totalBase.toLocaleString("pt-BR")} processados | {totalErro.toLocaleString("pt-BR")} erros</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer'  }}>
          <h3>Tempo Médio por Lote</h3>
          <p>{avgTempo} min</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>{tempoTotal.toLocaleString("pt-BR")} min economizados</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer'  }}>
          <h3>Tempo de Operação</h3>
          <p>{tempoTrabalhadoFmt ?? "—"}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>tempo total trabalhado nos lotes</p>
        </div>
      </div>

      {/* GRÁFICO */}
      <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer'  }}>
        <h3>Aprovados vs Glosados</h3>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <XAxis dataKey="nome" stroke={cores.texto} tick={{ fontSize: 13 }} />
              <YAxis stroke={cores.texto} tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="valor" fill={accentColor} name="Itens" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* FILTROS */}
      <div className="filtro">
        <div className="linha-filtros">
          <div className="grupo-filtro">
            <label>Lote:</label>
            <input
              className="filtro-processo"
              type="text"
              placeholder="Buscar lote"
              value={buscaLote}
              onChange={(e) => setBuscaLote(e.target.value)}
            />
          </div>
          <div className="grupo-filtro">
            <label>Cliente:</label>
            <select
              value={buscaCliente}
              onChange={(e) => setBuscaCliente(e.target.value)}
            >
              <option value="">Todos</option>
              {clientesUnicos.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="grupo-filtro">
            <label>Prestador:</label>
            <select
              value={buscaPrestador}
              onChange={(e) => setBuscaPrestador(e.target.value)}
            >
              <option value="">Todos</option>
              {prestadoresUnicos.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="grupo-filtro">
            <label>Status:</label>
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
              {["Todos", "Aprovados", "Glosados", "Erro do sistema"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="linha-filtros">
          <div className="grupo-filtro">
            <label>Período:</label>
            <input className="filtro-data" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            <span className="ate-text">até</span>
            <input className="filtro-data" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
          <button
            className="btn-tema"
            onClick={() => { setBuscaLote(""); setBuscaPrestador(""); setBuscaCliente(""); setFiltroStatus("Todos"); setDataInicio(""); setDataFim(""); }}
          >
            <span className="material-symbols-outlined">mop</span>
            Limpar Filtros
          </button>
        </div>
      </div>

      {/* TABELA */}
      <div className="tabela-container" style={{ backgroundColor: cores.card, color: cores.texto, marginTop: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid rgba(128,128,128,0.2)" }}>
          <h3 style={{ margin: 0 }}>Detalhamento</h3>
          <span style={{ fontSize: "13px", opacity: 0.8 }}>
            Mostrando {inicio + 1}—{Math.min(inicio + ITENS_POR_PAGINA, filtrados.length)} de {filtrados.length.toLocaleString("pt-BR")}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ color: cores.texto }}>Cliente</th>
                <th style={{ color: cores.texto }}>Prestador</th>
                <th style={{ color: cores.texto }}>Nº do Lote</th>
                <th style={{ color: cores.texto }}>Aprovados</th>
                <th style={{ color: cores.texto }}>Glosados</th>
                <th style={{ color: cores.texto }}>Erro</th>
                <th style={{ color: cores.texto }}>Tempo</th>
                <th style={{ color: cores.texto }}>Data</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ color: cores.texto, padding: 32 }}>Carregando...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={8} style={{ color: cores.texto, padding: 32 }}>Nenhum registro encontrado.</td></tr>
              ) : paginaDados.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: cores.texto }}>{r.cliente || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.prestador}</td>
                  <td style={{ color: cores.texto }}>{r.numero_lote}</td>
                  <td style={{ color: COLOR_APROV, fontWeight: 600 }}>{r.qtd_itens_aprovados ?? 0}</td>
                  <td style={{ color: r.qtd_itens_glosados > 0 ? COLOR_GLOS : cores.texto, fontWeight: r.qtd_itens_glosados > 0 ? 600 : 400 }}>
                    {r.qtd_itens_glosados ?? 0}
                  </td>
                  <td style={{ color: r.qtd_itens_erro > 0 ? COLOR_ERRO : cores.texto, fontWeight: r.qtd_itens_erro > 0 ? 600 : 400 }}>
                    {r.qtd_itens_erro ?? 0}
                  </td>
                  <td style={{ color: cores.texto }}>{r.tempo_gasto_minutos ?? 0}m {r.tempo_gasto_segundos ?? 0}s</td>
                  <td style={{ color: cores.texto }}>{formatarDataHora(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPaginas > 1 && (
          <div className="paginacao" style={{ borderTop: "1px solid rgba(128,128,128,0.2)" }}>
            <button className="paginacao-btn" onClick={() => irParaPagina(paginaSegura - 1)} disabled={paginaSegura <= 1}
              style={{ background: tema === "escuro" ? "#374151" : "#e5e7eb", color: cores.texto, fontWeight: "bold", padding: "6px 12px" }}>
              Anterior
            </button>
            {paginasVisiveis[0] > 1 && (
              <>
                <button className="paginacao-btn" onClick={() => irParaPagina(1)} style={{ background: cores.card, color: cores.texto }}>1</button>
                {paginasVisiveis[0] > 2 && <span style={{ color: cores.texto, opacity: 0.5 }}>...</span>}
              </>
            )}
            {paginasVisiveis.map(p => (
              <button key={p} className={`paginacao-btn ${p === paginaSegura ? "paginacao-ativa" : ""}`}
                onClick={() => irParaPagina(p)}
                style={{ background: p === paginaSegura ? accentColor : (tema === "escuro" ? "#374151" : "#e5e7eb"), color: p === paginaSegura ? "#fff" : cores.texto }}>
                {p}
              </button>
            ))}
            {paginasVisiveis[paginasVisiveis.length - 1] < totalPaginas && (
              <>
                {paginasVisiveis[paginasVisiveis.length - 1] < totalPaginas - 1 && <span style={{ color: cores.texto, opacity: 0.5 }}>...</span>}
                <button className="paginacao-btn" onClick={() => irParaPagina(totalPaginas)} style={{ background: cores.card, color: cores.texto }}>{totalPaginas}</button>
              </>
            )}
            <button className="paginacao-btn" onClick={() => irParaPagina(paginaSegura + 1)} disabled={paginaSegura >= totalPaginas}
              style={{ background: tema === "escuro" ? "#374151" : "#e5e7eb", color: cores.texto, fontWeight: "bold", padding: "6px 12px" }}>
              Próximo
            </button>
          </div>
        )}
      </div>

      <div className="acoes-tabela">
        <button className="btn-tema" onClick={exportarExcel}>
          <span className="material-symbols-outlined">download</span>
          Exportar Planilha
        </button>
      </div>
    </>
  );
}
