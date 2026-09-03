import { useState, useCallback, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import { buscarPaginado } from "../lib/supabaseFetch";
import { dataHojeBR } from "../lib/dateUtils";
import { usePollingFetch } from "../hooks/usePollingFetch";

// Código sem entrada aqui aparece cru no gráfico — o mapa pode crescer depois.
const TAXA_LABELS = {
  "40202038": "BIÓPSIA DA ENDOSCOPIA",
  "23020148": "BIOPSIA OU CITOLOGIA",
};

// Tabela nova, volume baixo — 5000 cobre com folga.
const MAX_LINHAS = 5000;

function formatarDataHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
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

export default function ExecucoesTaxasBiopsia({ tema, cores }) {
  const [busca, setBusca] = useState("");
  const [dataInicio, setDataInicio] = useState(dataHojeBR);
  const [dataFim, setDataFim] = useState("");
  const ITENS_POR_PAGINA = 20;
  const [pagina, setPagina] = useState(1);
  const [totais, setTotais] = useState({ nproc: 0, nguias: 0, ntaxas: 0, ntaxadas: 0 });

  const accentColor = tema === "escuro" ? "#FFCB05" : "#FF0073";

  const fetchExecucoes = useCallback(async (signal) => {
    // sem o desempate por id as páginas do .range() podem pular ou repetir linhas
    const montarQuery = () => {
      let q = supabase
        .from("execucoes_taxas_biopsia")
        .select("id, numero_processo, qtd_guias, qtd_taxas, qtd_guias_taxadas, qtd_corrigidas, codigos_taxas, data_execucao")
        .order("data_execucao", { ascending: false })
        .order("id", { ascending: false });
      if (dataInicio) {
        q = q.gte("data_execucao", dataInicio);
      } else if (!dataFim) {
        q = q.gte("data_execucao", inicioDoDiaISO());
      }
      if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
      if (signal) q = q.abortSignal(signal);
      return q;
    };
    return buscarPaginado(montarQuery, MAX_LINHAS);
  }, [dataInicio, dataFim]);

  const { data: dados, loading } = usePollingFetch(
    fetchExecucoes,
    120000,
    [dataInicio, dataFim]
  );

  useEffect(() => {
    let ativo = true;
    (async () => {
      let q = supabase
        .from("execucoes_taxas_biopsia")
        .select("nproc:id.count(), nguias:qtd_guias.sum(), ntaxas:qtd_taxas.sum(), ntaxadas:qtd_guias_taxadas.sum()");
      if (dataInicio) q = q.gte("data_execucao", dataInicio);
      if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
      const { data, error } = await q;
      if (!ativo || error) return;
      const t = data?.[0] || {};
      setTotais({
        nproc: t.nproc || 0,
        nguias: t.nguias || 0,
        ntaxas: t.ntaxas || 0,
        ntaxadas: t.ntaxadas || 0,
      });
    })();
    return () => { ativo = false; };
  }, [dataInicio, dataFim]);

  // codigos_taxas é um objeto {codigo: qtd}; somar em JS dispensa RPC no banco
  const topTaxas = useMemo(() => {
    const acc = {};
    for (const r of dados) {
      for (const [cod, qtd] of Object.entries(r.codigos_taxas || {})) {
        acc[cod] = (acc[cod] || 0) + (Number(qtd) || 0);
      }
    }
    return Object.entries(acc)
      .map(([codigo, qtd]) => ({ codigo, qtd }))
      .sort((a, b) => b.qtd - a.qtd);
  }, [dados]);

  let filtrados = dados;
  if (busca.trim()) {
    filtrados = filtrados.filter((r) =>
      (r.numero_processo || "").toLowerCase().includes(busca.trim().toLowerCase())
    );
  }

  const totalProcessos = totais.nproc;
  const totalGuias = totais.nguias;
  const totalTaxas = totais.ntaxas;
  const totalGuiasTaxadas = totais.ntaxadas;

  const chartData = topTaxas
    .slice(0, 8)
    .map((t) => {
      const codigo = t.codigo;
      const nome = TAXA_LABELS[codigo];
      const rotulo = nome ? `${codigo} - ${nome}` : codigo;
      return { nome: rotulo.length > 45 ? rotulo.slice(0, 45) + "…" : rotulo, valor: Number(t.qtd) };
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
      ["", "", "", "Total de processos", totalProcessos],
      ["", "", "", "Total de guias (filtrado)", totalGuias],
      ["", "", "", "Total de taxas (filtrado)", totalTaxas],
      ["", "", "", "Total de guias taxadas (filtrado)", totalGuiasTaxadas],
      [],
      ["Nº do Processo", "Qtd. Guias", "Qtd. Taxas", "Guias Taxadas", "Guias Corrigidas", "Códigos de Taxa", "Data de Execução"],
      ...filtrados.map((r) => [
        r.numero_processo,
        r.qtd_guias,
        r.qtd_taxas,
        r.qtd_guias_taxadas ?? 0,
        r.qtd_corrigidas ?? 0,
        Object.keys(r.codigos_taxas || {}).length,
        formatarDataHora(r.data_execucao),
      ]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Taxas Biópsia");
    XLSX.writeFile(wb, "execucoes_taxas_biopsia.xlsx");
  }

  return (
    <>
      {/* CARDS */}
      <div className="cards">
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Total de Processos</h3>
          <p>{totalProcessos.toLocaleString("pt-BR")}</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Total de Guias</h3>
          <p>{totalGuias.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>nos registros filtrados</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Total de Taxas</h3>
          <p>{totalTaxas.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>nos registros filtrados</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Guias Taxadas</h3>
          <p>{totalGuiasTaxadas.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>nos registros filtrados</p>
        </div>
      </div>

      {/* GRÁFICO */}
      {chartData.length > 0 && (
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' }}>
          <h3>Top Códigos de Taxa Mais Frequentes</h3>
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
            <label>Nº do Processo:</label>
            <input
              className="filtro-processo"
              type="text"
              placeholder="Buscar processo"
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
                <th style={{ color: cores.texto }}>Nº do Processo</th>
                <th style={{ color: cores.texto }}>Qtd. Guias</th>
                <th style={{ color: cores.texto }}>Qtd. Taxas</th>
                <th style={{ color: cores.texto }}>Guias Taxadas</th>
                <th style={{ color: cores.texto }}>Guias Corrigidas</th>
                <th style={{ color: cores.texto }}>Códigos de Taxa</th>
                <th style={{ color: cores.texto }}>Data de Execução</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ color: cores.texto, padding: 32 }}>Carregando...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={7} style={{ color: cores.texto, padding: 32 }}>Nenhum registro encontrado.</td></tr>
              ) : paginaDados.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: cores.texto }}>{r.numero_processo}</td>
                  <td style={{ color: cores.texto }}>{r.qtd_guias}</td>
                  <td style={{ color: cores.texto }}>{r.qtd_taxas}</td>
                  <td style={{ color: cores.texto }}>{r.qtd_guias_taxadas ?? 0}</td>
                  <td style={{ color: cores.texto }}>{r.qtd_corrigidas ?? 0}</td>
                  <td style={{ color: cores.texto }}>{Object.keys(r.codigos_taxas || {}).length}</td>
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
