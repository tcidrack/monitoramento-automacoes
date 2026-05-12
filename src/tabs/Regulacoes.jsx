import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import { usePollingFetch } from "../hooks/usePollingFetch";

const PROC_LABELS = {
  "90230007": "ENDOSCOPIA DIGESTIVA ALTA",
  "40202038": "BIÓPSIA DA ENDOSCOPIA",
  "40307840": "TESTE RÁPIDO PARA HELICOBACTERPYLORI",
  "90230006": "COLONOSCOPIA",
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

function getDataOnly(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function Regulacoes({ tema, cores }) {
  const [busca, setBusca] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const ITENS_POR_PAGINA = 20;
  const [pagina, setPagina] = useState(1);

  const accentColor = tema === "escuro" ? "#FFCB05" : "#FF0073";

  const fetchRegulacoes = useCallback(async () => {
    const { data, error } = await supabase
      .from("regulacoes")
      .select("*")
      .order("data_execucao", { ascending: false });
    if (!error) return data || [];
    return [];
  }, []);

  const { data: dados, loading } = usePollingFetch(fetchRegulacoes, 30000);

  function filtrarPorPeriodo(lista) {
    return lista.filter((r) => {
      const exec = getDataOnly(r.data_execucao);
      if (!exec) return false;
      if (dataInicio) {
        const [y, m, d] = dataInicio.split("-");
        if (exec < new Date(y, m - 1, d)) return false;
      }
      if (dataFim) {
        const [y, m, d] = dataFim.split("-");
        if (exec > new Date(y, m - 1, d)) return false;
      }
      return true;
    });
  }

  let filtrados = filtrarPorPeriodo(dados);
  if (busca.trim()) {
    filtrados = filtrados.filter((r) =>
      (r.numero_guia || "").toLowerCase().includes(busca.trim().toLowerCase())
    );
  }

  const totalGuias = filtrados.length;
  const totalProc = filtrados.reduce((acc, r) => acc + (r.procedimentos?.length || 0), 0);
  const media = totalGuias > 0 ? (totalProc / totalGuias).toFixed(1) : "0";

  // Contagem de procedimentos para gráfico
  const procCount = {};
  filtrados.forEach((r) => {
    r.procedimentos?.forEach((p) => {
      procCount[p] = (procCount[p] || 0) + 1;
    });
  });
  const chartData = Object.entries(procCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([codigo, valor]) => {
      const nome = PROC_LABELS[codigo];
      const rotulo = nome ? `${codigo} - ${nome}` : codigo;
      return { nome: rotulo.length > 45 ? rotulo.slice(0, 45) + "…" : rotulo, valor };
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

  useEffect(() => { setPagina(1); }, [busca, dataInicio, dataFim]);

  function exportarExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["", "", "", "Total de guias", filtrados.length],
      ["", "", "", "Total de procedimentos", totalProc],
      ["", "", "", "Média por guia", media],
      [],
      ["Nº da Guia", "Qtd. Procedimentos", "Data de Execução"],
      ...filtrados.map((r) => [
        r.numero_guia || "—",
        r.procedimentos?.length ?? 0,
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
          <h3>Média por Guia</h3>
          <p>{media} proc.</p>
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
          <label>Nº da Guia:</label>
          <input
            className="filtro-processo"
            type="text"
            placeholder="Buscar número da guia"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
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
          <button
            className="btn-tema"
            onClick={() => { setBusca(""); setDataInicio(""); setDataFim(""); }}
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
                <th style={{ color: cores.texto }}>Data de Execução</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} style={{ color: cores.texto, padding: 32 }}>Carregando...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={3} style={{ color: cores.texto, padding: 32 }}>Nenhum registro encontrado.</td></tr>
              ) : paginaDados.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: cores.texto }}>{r.numero_guia || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.procedimentos?.length ?? 0}</td>
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
