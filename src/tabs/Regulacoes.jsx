import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import { dataHojeBR, formatarDuracao } from "../lib/dateUtils";
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
  "90230018": "VIDEO-FARINGO-LARINGOSCOPIA COM ENDOSCOPIO RIGIDO",
  "90230030": "VIDEO-FARINGO-LARINGOSCOPIA COM ENDOSCOPIA RIGIDA E FLEXIVEL",
  "90320001": "PLETISMOGRAFIA",
  "40103315": "ELETRONEUROMIOGRAFIA DE MMII",
  "40103323": "ELETRONEUROMIOGRAFIA DE MMSS",
  "28050690": "TESTOSTERONA PLASMATICA",
  "28011376": "TRANSAMINASE PIRUVICA (TGP)",
  "28010175": "ACIDO URICO",
  "28010957": "GAMA-GLUTAMIL TRANSFERASE",
  "28011414": "UREIA",
  "28011368": "TRANSAMINASE OXALACETICA (TGO)",
  "28040481":  "HEMOGRAMA",
  "28010973":  "GLICOSE",
  "28011023":  "HEMOGLOBINA GLICOSILADA",
  "28061624":  "PSA (ANTIGENO PROSTATICO ESPECIFICO)",
  "28010540":  "CREATININA",
  "28050703":  "TIREO-ESTIMULANTE (TSH)",
  "28010507":  "COLESTEROL TOTAL",
  "28011511":  "COLESTEROL LDL",
  "28011392":  "TRIGLICERIDIOS",
  "28011384":  "TRANSFERRINA",
  "28011520":  "COLESTEROL VLDL",
  "28010493":  "COLESTEROL HDL",
  "28050720":  "TIROXINA LIVRE",
  "28010299":  "BILIRRUBINA TOTAL E FRACOES",
  "28010795":  "FERRITINA",
  "40302830":  "VITAMINA D 25 HIDROXI",
  "28011449":  "VITAMINA B-12 (RIE)",
  "28010850":  "FOSFATASE ALCALINA",
  "28130367":  "ROTINA DE URINA (SUMARIO DE URINA)",
  "28050770":  "TESTOSTERONA LIVRE",
};

const LAB_CODES = new Set([
  "28050690","28011376","28010175","28010957","28011414","28011368","28040481",
  "28010973","28011023","28061624","28010540","28050703","28010507","28011511",
  "28011392","28011384","28011520","28010493","28050720","28010299","28010795",
  "40302830","28011449","28010850","28130367","28050770",
]);

const PROC_OPCOES = [
  { value: "LABORATORIO", label: "EXAME LABORATORIAL" },
  ...Object.keys(PROC_LABELS)
    .filter((c) => !LAB_CODES.has(c))
    .map((c) => ({ value: c, label: PROC_LABELS[c] })),
].sort((a, b) => a.label.localeCompare(b.label));

function nomesProcedimentos(procs) {
  if (!Array.isArray(procs) || procs.length === 0) return "—";
  return procs.map((c) => PROC_LABELS[c] || c).join(", ");
}

const REGRA_TEXTO = {
  EDA: "Sem periodicidade.",
  COLONOSCOPIA: "A partir de 45 anos, sem periodicidade.",
  COLONOSCOPIA_BIOPSIA: "A partir de 45 anos, sem periodicidade.",
  "10101012": "Sem periodicidade.",
  EEG_ROTINA: "A partir de 60 anos, sem periodicidade.",
  POLISSONOGRAFIA: "A partir de 45 anos, sem periodicidade.",
  VIDEO_LARINGO_RIGIDO: "Sem periodicidade.",
  VIDEO_LARINGO_RIGIDO_FLEXIVEL: "Sem periodicidade.",
  PLETISMOGRAFIA: "A partir de 45 anos, sem periodicidade.",
  LABORATORIO: "Sem regra especifica.",
  ELETRONEUROMIOGRAFIA: "A partir de 60 anos, sem periodicidade.",
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
  const [procFiltro, setProcFiltro] = useState("");
  const [totalGuiasServer, setTotalGuiasServer] = useState(0);
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
    if (procFiltro === "LABORATORIO") q = q.eq("regra_aplicada", "LABORATORIO");
    else if (procFiltro) q = q.contains("procedimentos", [procFiltro]);
    q = q.limit(5000);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) return [];
    return data || [];
  }, [dataInicio, dataFim, procFiltro]);

  const { data: dados, loading } = usePollingFetch(
    fetchRegulacoes,
    120000,
    [dataInicio, dataFim, procFiltro]
  );

  useEffect(() => {
    let ativo = true;
    (async () => {
      let q = supabase.from("regulacoes").select("*", { count: "exact", head: true });
      if (dataInicio) q = q.gte("data_execucao", dataInicio);
      if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
      if (procFiltro === "LABORATORIO") q = q.eq("regra_aplicada", "LABORATORIO");
      else if (procFiltro) q = q.contains("procedimentos", [procFiltro]);
      const { count } = await q;
      if (ativo) setTotalGuiasServer(count || 0);
    })();
    return () => { ativo = false; };
  }, [dataInicio, dataFim, procFiltro]);

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

  // Contagem de procedimentos derivada dos dados carregados (respeita o filtro de procedimento)
  const topProc = (() => {
    const contagem = new Map();
    for (const r of dados) {
      if (!Array.isArray(r.procedimentos)) continue;
      for (const codigo of r.procedimentos) {
        if (!codigo) continue;
        contagem.set(codigo, (contagem.get(codigo) || 0) + 1);
      }
    }
    return [...contagem.entries()]
      .map(([codigo, qtd]) => ({ codigo, qtd }))
      .sort((a, b) => b.qtd - a.qtd);
  })();
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
    return Math.round(total / buckets.size);
  })();

  // Tempo de operação: janela da 1ª à última guia do período (inclui pausas)
  const tempoOperacao = (() => {
    let min = Infinity, max = -Infinity;
    for (const r of dados) {
      const t = new Date(r.data_execucao).getTime();
      if (isNaN(t)) continue;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    if (max <= min) return null;
    return formatarDuracao(Math.round((max - min) / 60000));
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

  useEffect(() => { setPagina(1); }, [busca, dataInicio, dataFim, procFiltro]);

  function exportarExcel() {
    const media = filtrados.length > 0 ? (totalProc / filtrados.length).toFixed(1) : 0;
    const ws = XLSX.utils.aoa_to_sheet([
      ["", "", "", "Total de guias", filtrados.length],
      ["", "", "", "Total de procedimentos", totalProc],
      ["", "", "", "Média por guia", media],
      [],
      ["Nº da Guia", "Procedimentos", "Qtd. Procedimentos", "Regra Aplicada", "Data de Execução"],
      ...filtrados.map((r) => [
        r.numero_guia || "—",
        nomesProcedimentos(r.procedimentos),
        r.procedimentos?.length ?? 0,
        REGRA_TEXTO[r.regra_aplicada] || "—",
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
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Tempo de Operação</h3>
          <p>{tempoOperacao ?? "—"}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>da 1ª à última guia do período</p>
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
            <label>Procedimento:</label>
            <select
              className="filtro-processo"
              value={procFiltro}
              onChange={(e) => setProcFiltro(e.target.value)}
            >
              <option value="">Todos</option>
              {PROC_OPCOES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
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
            onClick={() => { setBusca(""); setDataInicio(""); setDataFim(""); setProcFiltro(""); }}
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
                <th style={{ color: cores.texto }}>Procedimentos</th>
                <th style={{ color: cores.texto }}>Qtd. Procedimentos</th>
                <th style={{ color: cores.texto }}>Regra Aplicada</th>
                <th style={{ color: cores.texto }}>Data de Execução</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ color: cores.texto, padding: 32 }}>Carregando...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={5} style={{ color: cores.texto, padding: 32 }}>Nenhum registro encontrado.</td></tr>
              ) : paginaDados.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: cores.texto }}>{r.numero_guia || "—"}</td>
                  <td style={{ color: cores.texto }}>
                    {Array.isArray(r.procedimentos) && r.procedimentos.length > 0
                      ? r.procedimentos.map((c, idx) => (
                          <div key={idx}>{PROC_LABELS[c] || c}</div>
                        ))
                      : "—"}
                  </td>
                  <td style={{ color: cores.texto }}>{r.procedimentos?.length ?? 0}</td>
                  <td style={{ color: cores.texto }}>{REGRA_TEXTO[r.regra_aplicada] || "—"}</td>
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
