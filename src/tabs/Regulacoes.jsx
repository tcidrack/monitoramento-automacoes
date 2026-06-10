import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import { dataHojeBR } from "../lib/dateUtils";
import { usePollingFetch } from "../hooks/usePollingFetch";

const PROC_LABELS = {
  "90230007": "ENDOSCOPIA DIGESTIVA ALTA",
  "40202038": "BIÓPSIA DA ENDOSCOPIA",
  "40307840": "TESTE RÁPIDO PARA HELICOBACTERPYLORI",
  "90230006": "COLONOSCOPIA",
  "23020148": "BIOPSIA OU CITOLOGIA",
  "40103170": "EEG DE ROTINA",
  "10101012": "CONSULTA ELETIVA",
  "40103536": "POLISSONOGRAMA COM EEG DE NOITE INTEIRA",
  "90230018": "IDEO-FARINGO-LARINGOSCOPIA COM ENDOSCOPIO RIGIDO",
  "90230030": "VIDEO-FARINGO-LARINGOSCOPIA COM ENDOSCOPIA RIGIDA E FLEXIVEL",
  "90320001": "PLETISMOGRAFIA",
};

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

export default function Regulacoes({ tema, cores }) {
  const [busca, setBusca] = useState("");
  const [dataInicio, setDataInicio] = useState(dataHojeBR);
  const [dataFim, setDataFim] = useState("");
  const [regraFiltro, setRegraFiltro] = useState("");
  const [regrasUnicas, setRegrasUnicas] = useState([]);
  const [totalGuiasServer, setTotalGuiasServer] = useState(0);
  const [topProc, setTopProc] = useState([]);
  const [totalPendenteDia, setTotalPendenteDia] = useState(null);
  const [processadasDia, setProcessadasDia] = useState(0);
  const ITENS_POR_PAGINA = 20;
  const [pagina, setPagina] = useState(1);

  const FILA_GEPRO = "gepro_analise_tecnica";
  const diaSelecionado = dataInicio || dataHojeBR();

  const accentColor = tema === "escuro" ? "#FFCB05" : "#FF0073";

  const fetchRegulacoes = useCallback(async (signal) => {
    let q = supabase
      .from("regulacoes")
      .select("id, numero_guia, procedimentos, regra_aplicada, data_execucao")
      .order("data_execucao", { ascending: false });
    if (dataInicio) {
      q = q.gte("data_execucao", dataInicio);
    } else if (!dataFim) {
      q = q.gte("data_execucao", inicioDoDiaISO());
    }
    if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
    if (regraFiltro) q = q.eq("regra_aplicada", regraFiltro);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) return [];
    return data || [];
  }, [dataInicio, dataFim, regraFiltro]);

  const { data: dados, loading } = usePollingFetch(
    fetchRegulacoes,
    120000,
    [dataInicio, dataFim, regraFiltro]
  );

  useEffect(() => {
    const KEY = "regulacoes_regras_cache";
    const cached = localStorage.getItem(KEY);
    if (cached) {
      try {
        const { ts, data } = JSON.parse(cached);
        if (Date.now() - ts < 24 * 60 * 60 * 1000) {
          setRegrasUnicas(data);
          return;
        }
      } catch { /* cache inválido, segue para fetch */ }
    }
    let ativo = true;
    (async () => {
      const { data, error } = await supabase
        .from("regulacoes")
        .select("regra_aplicada")
        .not("regra_aplicada", "is", null)
        .limit(5000);
      if (!ativo || error) return;
      const unicas = [...new Set((data || []).map((r) => r.regra_aplicada).filter(Boolean))].sort();
      setRegrasUnicas(unicas);
      localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), data: unicas }));
    })();
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const { data, error } = await supabase.rpc("regulacoes_top_procedimentos", {
        d_inicio: dataInicio || null,
        d_fim: dataFim ? dataFim + "T23:59:59" : null,
        regra: regraFiltro || null,
        limite: 1000,
      });
      if (!ativo || error) return;
      setTopProc(data || []);
    })();
    return () => { ativo = false; };
  }, [dataInicio, dataFim, regraFiltro]);

  useEffect(() => {
    let ativo = true;
    (async () => {
      let q = supabase.from("regulacoes").select("*", { count: "exact", head: true });
      if (dataInicio) q = q.gte("data_execucao", dataInicio);
      if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
      if (regraFiltro) q = q.eq("regra_aplicada", regraFiltro);
      const { count } = await q;
      if (ativo) setTotalGuiasServer(count || 0);
    })();
    return () => { ativo = false; };
  }, [dataInicio, dataFim, regraFiltro]);

  // Total pendente congelado do início do dia selecionado (fila GEPRO)
  useEffect(() => {
    let ativo = true;
    (async () => {
      const { data } = await supabase
        .from("sistema_totais")
        .select("total_pendente")
        .eq("fila", FILA_GEPRO)
        .eq("dia", diaSelecionado)
        .maybeSingle();
      if (!ativo) return;
      setTotalPendenteDia(data?.total_pendente ?? null);
    })();
    return () => { ativo = false; };
  }, [diaSelecionado]);

  // Guias processadas pela automação no dia selecionado
  useEffect(() => {
    let ativo = true;
    (async () => {
      const { count } = await supabase
        .from("regulacoes")
        .select("*", { count: "exact", head: true })
        .gte("data_execucao", diaSelecionado)
        .lte("data_execucao", diaSelecionado + "T23:59:59");
      if (ativo) setProcessadasDia(count || 0);
    })();
    return () => { ativo = false; };
  }, [diaSelecionado]);

  let filtrados = dados;
  if (busca.trim()) {
    filtrados = filtrados.filter((r) =>
      (r.numero_guia || "").toLowerCase().includes(busca.trim().toLowerCase())
    );
  }

  const totalGuias = totalGuiasServer;
  const totalProc = topProc.reduce((acc, p) => acc + Number(p.qtd || 0), 0);

  // Média de tempo entre guias consecutivas — gaps > 10 min excluídos (automação pausada)
  const LIMIAR_GAP_MS = 10 * 60 * 1000;
  const mediaTempoGuia = (() => {
    if (dados.length < 2) return null;
    const sorted = [...dados].sort((a, b) => new Date(a.data_execucao) - new Date(b.data_execucao));
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(new Date(sorted[i].data_execucao) - new Date(sorted[i - 1].data_execucao));
    }
    const validos = gaps.filter((g) => g <= LIMIAR_GAP_MS);
    if (validos.length === 0) return null;
    const avgSec = validos.reduce((a, b) => a + b, 0) / validos.length / 1000;
    return avgSec < 60 ? `${avgSec.toFixed(1)} seg` : `${(avgSec / 60).toFixed(1)} min`;
  })();

  // Média de guias processadas por minuto (agrupando data_execucao por minuto)
  const guiasPorMinuto = (() => {
    if (dados.length === 0) return null;
    const buckets = new Map();
    for (const r of dados) {
      if (!r.data_execucao) continue;
      const d = new Date(r.data_execucao);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    if (buckets.size === 0) return null;
    const total = [...buckets.values()].reduce((a, b) => a + b, 0);
    return (total / buckets.size).toFixed(1);
  })();

  // Cobertura: guias feitas no dia ÷ total congelado do início daquele dia
  const pctAutomacao = (totalPendenteDia && totalPendenteDia > 0)
    ? ((processadasDia / totalPendenteDia) * 100).toFixed(1)
    : null;
  const diaLabel = diaSelecionado.split("-").reverse().join("/");

  const chartData = topProc
    .slice(0, 8)
    .map((p) => {
      const codigo = p.codigo;
      const nome = PROC_LABELS[codigo];
      const rotulo = nome ? `${codigo} - ${nome}` : codigo;
      return { nome: rotulo.length > 45 ? rotulo.slice(0, 45) + "…" : rotulo, valor: Number(p.qtd) };
    });

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

  useEffect(() => { setPagina(1); }, [busca, dataInicio, dataFim, regraFiltro]);

  function exportarExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["", "", "", "Total de guias", filtrados.length],
      ["", "", "", "Total de procedimentos", totalProc],
      ["", "", "", "Média por guia", media],
      [],
      ["Nº da Guia", "Qtd. Procedimentos", "Data de Execução", "Regra Aplicada"],
      ...filtrados.map((r) => [
        r.numero_guia || "—",
        r.procedimentos?.length ?? 0,
        r.regra_aplicada || "",
        formatarDataHora(r.data_execucao),
      ]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Regulações");
    XLSX.writeFile(wb, "regulacoes.xlsx");
  }

  return (
    <>
      {/* CARDS */}
      <div className="cards">
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Total de Guias Reguladas</h3>
          <p>{totalGuias.toLocaleString("pt-BR")}</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Total de Procedimentos</h3>
          <p>{totalProc.toLocaleString("pt-BR")}</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Tempo Médio entre Guias</h3>
          <p>{mediaTempoGuia ?? "—"}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>intervalo médio de processamento</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Guias por Minuto</h3>
          <p>{guiasPorMinuto ?? "—"}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>média por minuto ativo</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>% Feito pela Automação</h3>
          <p>{pctAutomacao != null ? `${pctAutomacao}%` : "—"}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>
            {totalPendenteDia != null
              ? `${processadasDia.toLocaleString("pt-BR")} de ${totalPendenteDia.toLocaleString("pt-BR")} pendentes · ${diaLabel}`
              : `sem total do sistema em ${diaLabel}`}
          </p>
        </div>
      </div>

      {/* GRÁFICO */}
      {chartData.length > 0 && (
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Top Procedimentos Mais Frequentes</h3>
          <div style={{ width: "100%", height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} layout="vertical">
                <XAxis type="number" stroke={cores.texto} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="nome" width={300} stroke={cores.texto} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="valor" fill={accentColor} name="Ocorrências" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* FILTROS */}
      <div className="filtro">
        <div className="linha-filtros">
          <div className="grupo-filtro">
            <label>Nº da Guia:</label>
            <input
              className="filtro-processo"
              type="text"
              placeholder="Buscar número da guia"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="grupo-filtro">
            <label>Regra:</label>
            <select
              className="filtro-processo"
              value={regraFiltro}
              onChange={(e) => setRegraFiltro(e.target.value)}
            >
              <option value="">Todas</option>
              {regrasUnicas.map((r) => (
                <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div className="grupo-filtro">
            <label>Período:</label>
            <input
              className="filtro-data"
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
            />
            <span className="ate-text">até</span>
            <input
              className="filtro-data"
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
            />
          </div>
          <button
            className="btn-tema"
            onClick={() => { setBusca(""); setDataInicio(""); setDataFim(""); setRegraFiltro(""); }}
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
                <th style={{ color: cores.texto }}>Nº da Guia</th>
                <th style={{ color: cores.texto }}>Qtd. Procedimentos</th>
                <th style={{ color: cores.texto }}>Regra Aplicada</th>
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
                  <td style={{ color: cores.texto }}>{r.numero_guia || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.procedimentos?.length ?? 0}</td>
                  <td style={{ color: cores.texto }}>{r.regra_aplicada ? r.regra_aplicada.replace(/_/g, " ") : "—"}</td>
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

      {/* AÇÕES */}
      <div className="acoes-tabela">
        <button className="btn-tema" onClick={exportarExcel}>
          <span className="material-symbols-outlined">download</span>
          Exportar Planilha
        </button>
      </div>
    </>
  );
}
