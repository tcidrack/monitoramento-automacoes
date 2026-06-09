import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import { dataHojeBR } from "../lib/dateUtils";
import { usePollingFetch } from "../hooks/usePollingFetch";

function formatarDataHora(iso) {
  if (!iso) return "—";
  // Supabase retorna TIMESTAMPTZ com offset (+00:00); new Date() aceita ISO 8601 com offset nativamente
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
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

const RESULTADO_LABEL = {
  enviado_tela_60: "Enviado à Tela 60",
  pendencia_gerada: "Pendência Gerada",
};

export default function Triagem({ tema, cores }) {
  const [busca, setBusca] = useState("");
  const [dataInicio, setDataInicio] = useState(dataHojeBR);
  const [dataFim, setDataFim] = useState("");
  const [filtroResultado, setFiltroResultado] = useState("");
  const ITENS_POR_PAGINA = 20;
  const [pagina, setPagina] = useState(1);

  const accentColor = tema === "escuro" ? "#FFCB05" : "#FF0073";
  const COLOR_COM = tema === "escuro" ? "#34d399" : "#059669";
  const COLOR_SEM = tema === "escuro" ? "#f87171" : "#dc2626";

  const fetchGuias = useCallback(async (signal) => {
    let q = supabase
      .from("verificacao_anexos")
      .select("id, numero_guia, tem_anexo, resultado, data_execucao")
      .order("data_execucao", { ascending: false });
    if (dataInicio) {
      q = q.gte("data_execucao", dataInicio);
    }
    if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) return [];
    return data || [];
  }, [dataInicio, dataFim]);

  const { data: dados, loading } = usePollingFetch(
    fetchGuias,
    120000,
    [dataInicio, dataFim]
  );

  const [totais, setTotais] = useState({ total: 0, comAnexo: 0, semAnexo: 0 });

  useEffect(() => {
    let ativo = true;
    (async () => {
      function buildQ(filtroAnexo) {
        let q = supabase
          .from("verificacao_anexos")
          .select("*", { count: "exact", head: true });
        if (dataInicio) {
          q = q.gte("data_execucao", dataInicio);
        }
        if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
        if (filtroAnexo != null) q = q.eq("tem_anexo", filtroAnexo);
        return q;
      }
      const [totalRes, comAnexoRes] = await Promise.all([
        buildQ(),
        buildQ(true),
      ]);
      if (!ativo) return;
      const total    = totalRes.count ?? 0;
      const comAnexo = comAnexoRes.count ?? 0;
      setTotais({ total, comAnexo, semAnexo: total - comAnexo });
    })();
    return () => { ativo = false; };
  }, [dataInicio, dataFim]);

  let filtrados = dados;
  if (busca.trim()) {
    filtrados = filtrados.filter((r) =>
      (r.numero_guia || "").toLowerCase().includes(busca.trim().toLowerCase())
    );
  }
  if (filtroResultado) {
    filtrados = filtrados.filter((r) => r.resultado === filtroResultado);
  }

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

  const pctComAnexo = totais.total > 0
    ? ((totais.comAnexo / totais.total) * 100).toFixed(1)
    : "0.0";
  const pctSemAnexo = totais.total > 0
    ? ((totais.semAnexo / totais.total) * 100).toFixed(1)
    : "0.0";

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

  useEffect(() => { setPagina(1); }, [busca, dataInicio, dataFim, filtroResultado]);

  function exportarExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["", "", "Total de guias processadas", totais.total],
      ["", "", "Com anexo (enviadas à Tela 60)", totais.comAnexo],
      ["", "", "Sem anexo (pendência gerada)", totais.semAnexo],
      [],
      ["Nº da Guia", "Resultado", "Data de Execução"],
      ...filtrados.map((r) => [
        r.numero_guia,
        RESULTADO_LABEL[r.resultado] ?? r.resultado,
        formatarDataHora(r.data_execucao),
      ]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Triagem");
    XLSX.writeFile(wb, "triagem.xlsx");
  }

  return (
    <>
      {/* CARDS */}
      <div className="cards">
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: "pointer" }}>
          <h3>Total de Guias Processadas</h3>
          <p>{totais.total.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>no período filtrado</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: "pointer" }}>
          <h3>Com Anexo</h3>
          <p style={{ color: COLOR_COM }}>{totais.comAnexo.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>{pctComAnexo}% — enviadas à Tela 60</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: "pointer" }}>
          <h3>Sem Anexo</h3>
          <p style={{ color: COLOR_SEM }}>{totais.semAnexo.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>{pctSemAnexo}% — pendência gerada</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: "pointer" }}>
          <h3>Tempo Médio entre Guias</h3>
          <p>{mediaTempoGuia ?? "—"}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>intervalo médio de processamento</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: "pointer" }}>
          <h3>Guias por Minuto</h3>
          <p>{guiasPorMinuto ?? "—"}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>média por minuto ativo</p>
        </div>
      </div>

      {/* FILTROS */}
      <div className="filtro">
        <div className="linha-filtros">
          <div className="grupo-filtro">
            <label>Nº da Guia:</label>
            <input
              className="filtro-processo"
              type="text"
              placeholder="Buscar guia"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="grupo-filtro">
            <label>Período:</label>
            <input className="filtro-data" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            <span className="ate-text">até</span>
            <input className="filtro-data" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
          <div className="grupo-filtro">
            <label>Resultado:</label>
            <select
              className="filtro-processo"
              value={filtroResultado}
              onChange={(e) => setFiltroResultado(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="enviado_tela_60">Com Anexo — Tela 60</option>
              <option value="pendencia_gerada">Sem Anexo — Pendência</option>
            </select>
          </div>
          <button
            className="btn-tema"
            onClick={() => { setBusca(""); setDataInicio(""); setDataFim(""); setFiltroResultado(""); }}
          >
            <span className="material-symbols-outlined">mop</span>
            Limpar Filtros
          </button>
        </div>
      </div>

      {/* TABELA */}
      <div className="tabela-container" style={{ backgroundColor: cores.card, color: cores.texto, marginTop: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid rgba(128,128,128,0.2)" }}>
          <h3 style={{ margin: 0 }}>Detalhamento por Guia</h3>
          <span style={{ fontSize: "13px", opacity: 0.8 }}>
            Mostrando {filtrados.length === 0 ? 0 : inicio + 1}—{Math.min(inicio + ITENS_POR_PAGINA, filtrados.length)} de {filtrados.length.toLocaleString("pt-BR")}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ color: cores.texto }}>Nº da Guia</th>
                <th style={{ color: cores.texto }}>Resultado</th>
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
                  <td style={{ color: cores.texto }}>{r.numero_guia}</td>
                  <td style={{ color: cores.texto }}>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: r.tem_anexo ? "#16a34a22" : "#dc262622",
                      color: r.tem_anexo
                        ? (tema === "escuro" ? "#4ade80" : "#16a34a")
                        : (tema === "escuro" ? "#f87171" : "#dc2626"),
                    }}>
                      {RESULTADO_LABEL[r.resultado] ?? r.resultado}
                    </span>
                  </td>
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
