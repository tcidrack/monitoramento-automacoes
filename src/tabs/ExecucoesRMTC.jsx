import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import { usePollingFetch } from "../hooks/usePollingFetch";

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

function dataHoje() {
  return new Date().toISOString().slice(0, 10);
}

export default function ExecucoesRMTC({ tema, cores }) {
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("Todos");
  const [dataInicio, setDataInicio] = useState(dataHoje);
  const [dataFim, setDataFim] = useState("");
  const [totalRM, setTotalRM] = useState(0);
  const [totalTC, setTotalTC] = useState(0);
  const [totalGuiasServer, setTotalGuiasServer] = useState(0);
  const ITENS_POR_PAGINA = 20;
  const [pagina, setPagina] = useState(1);

  const accentColor = tema === "escuro" ? "#FFCB05" : "#FF0073";
  const COLOR_RM = tema === "escuro" ? "#60a5fa" : "#1d4ed8";
  const COLOR_TC = tema === "escuro" ? "#f87171" : "#dc2626";

  const fetchExecucoes = useCallback(async (signal) => {
    let q = supabase
      .from("execucoes_rmtc")
      .select("id, numero_processo, tipo, quantidade_guias, data_execucao")
      .order("data_execucao", { ascending: false })
      .limit(200);
    if (dataInicio) {
      q = q.gte("data_execucao", dataInicio);
    } else if (!dataFim) {
      q = q.gte("data_execucao", inicioDoDiaISO());
    }
    if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
    if (filtroTipo !== "Todos") q = q.eq("tipo", filtroTipo);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) return [];
    return data || [];
  }, [dataInicio, dataFim, filtroTipo]);

  const { data: dados, loading } = usePollingFetch(
    fetchExecucoes,
    120000,
    [dataInicio, dataFim, filtroTipo]
  );

  useEffect(() => {
    let ativo = true;
    const countTipo = (tipo) => {
      let q = supabase
        .from("execucoes_rmtc")
        .select("tipo", { count: "exact", head: true })
        .eq("tipo", tipo);
      if (dataInicio) q = q.gte("data_execucao", dataInicio);
      if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
      return q;
    };
    (async () => {
      const [{ count: cRM }, { count: cTC }] = await Promise.all([countTipo("RM"), countTipo("TC")]);
      if (!ativo) return;
      setTotalRM(cRM || 0);
      setTotalTC(cTC || 0);
    })();
    return () => { ativo = false; };
  }, [dataInicio, dataFim]);

  useEffect(() => {
    let ativo = true;
    (async () => {
      let q = supabase.from("execucoes_rmtc").select("nguias:quantidade_guias.sum()");
      if (dataInicio) q = q.gte("data_execucao", dataInicio);
      if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
      if (filtroTipo !== "Todos") q = q.eq("tipo", filtroTipo);
      const { data, error } = await q;
      if (!ativo || error) return;
      setTotalGuiasServer(data?.[0]?.nguias || 0);
    })();
    return () => { ativo = false; };
  }, [dataInicio, dataFim, filtroTipo]);

  let filtrados = dados;
  if (busca.trim()) {
    filtrados = filtrados.filter((r) =>
      (r.numero_processo || "").toLowerCase().includes(busca.trim().toLowerCase())
    );
  }

  const totalGuias = totalGuiasServer;

  const chartData = [
    { nome: "RM", valor: totalRM },
    { nome: "TC", valor: totalTC },
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

  useEffect(() => { setPagina(1); }, [busca, filtroTipo, dataInicio, dataFim]);

  function exportarExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["", "", "", "Total RM", totalRM],
      ["", "", "", "Total TC", totalTC],
      ["", "", "", "Total de guias (filtrado)", totalGuias],
      [],
      ["Nº do Processo", "Tipo", "Qtd. Guias", "Data de Execução"],
      ...filtrados.map((r) => [
        r.numero_processo,
        r.tipo,
        r.quantidade_guias,
        formatarDataHora(r.data_execucao),
      ]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Execuções RM-TC");
    XLSX.writeFile(wb, "execucoes_rmtc.xlsx");
  }

  return (
    <>
      {/* CARDS */}
      <div className="cards">
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Total de Processos RM</h3>
          <p style={{ color: COLOR_RM }}>{totalRM.toLocaleString("pt-BR")}</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Total de Processos TC</h3>
          <p style={{ color: COLOR_TC }}>{totalTC.toLocaleString("pt-BR")}</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Total de Guias</h3>
          <p>{totalGuias.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>nos registros filtrados</p>
        </div>
      </div>

      {/* GRÁFICO */}
      <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
        <h3>Distribuição RM vs TC</h3>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <XAxis dataKey="nome" stroke={cores.texto} tick={{ fontSize: 13 }} />
              <YAxis stroke={cores.texto} tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="valor" fill={accentColor} name="Processos" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* FILTROS */}
      <div className="filtro">
        <div className="linha-filtros">
          <label>Nº do Processo:</label>
          <input
            className="filtro-processo"
            type="text"
            placeholder="Buscar processo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <label>Tipo:</label>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            {["Todos", "RM", "TC"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <label>Período:</label>
          <input className="filtro-data" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          <span className="ate-text">até</span>
          <input className="filtro-data" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          <button
            className="btn-tema"
            onClick={() => { setBusca(""); setFiltroTipo("Todos"); setDataInicio(""); setDataFim(""); }}
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
                <th style={{ color: cores.texto }}>Nº do Processo</th>
                <th style={{ color: cores.texto }}>Tipo</th>
                <th style={{ color: cores.texto }}>Qtd. de Guias</th>
                <th style={{ color: cores.texto }}>Data de Execução</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ color: cores.texto, padding: 32 }}>Carregando...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={4} style={{ color: cores.texto, padding: 32 }}>Nenhum registro encontrado.</td></tr>
              ) : paginaDados.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: cores.texto }}>{r.numero_processo}</td>
                  <td style={{ color: cores.texto }}>
                    <span className={r.tipo === "RM" ? "badge-rm" : "badge-tc"}>{r.tipo}</span>
                  </td>
                  <td style={{ color: cores.texto }}>{r.quantidade_guias}</td>
                  <td style={{ color: cores.texto }}>{formatarDataHora(r.data_execucao)}</td>
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
