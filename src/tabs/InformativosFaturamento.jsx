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

export default function InformativosFaturamento({ tema, cores }) {
  const [busca, setBusca] = useState("");
  const [dataInicio, setDataInicio] = useState(dataHojeBR);
  const [dataFim, setDataFim] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroPrestador, setFiltroPrestador] = useState("");
  const ITENS_POR_PAGINA = 20;
  const [pagina, setPagina] = useState(1);

  const [clientes, setClientes] = useState([]);
  const [prestadores, setPrestadores] = useState([]);

  const accentColor = tema === "escuro" ? "#FFCB05" : "#FF0073";

  const fetchInformativos = useCallback(async (signal) => {
    let q = supabase
      .from("informativos_faturamento")
      .select("id, cliente, prestador, cnpj, numero_lote, nup, mes_faturamento, arquivo, created_at")
      .order("created_at", { ascending: false });
    if (dataInicio) q = q.gte("created_at", dataInicio);
    if (dataFim) q = q.lte("created_at", dataFim + "T23:59:59");
    if (filtroCliente) q = q.eq("cliente", filtroCliente);
    if (filtroPrestador) q = q.eq("prestador", filtroPrestador);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) return [];
    return data || [];
  }, [dataInicio, dataFim, filtroCliente, filtroPrestador]);

  const { data: dados, loading } = usePollingFetch(
    fetchInformativos,
    120000,
    [dataInicio, dataFim, filtroCliente, filtroPrestador]
  );

  // Valores únicos para os dropdowns de Cliente e Prestador
  useEffect(() => {
    let ativo = true;
    (async () => {
      const [cliRes, presRes] = await Promise.all([
        supabase.from("informativos_faturamento").select("cliente").not("cliente", "is", null).limit(5000),
        supabase.from("informativos_faturamento").select("prestador").not("prestador", "is", null).limit(5000),
      ]);
      if (!ativo) return;
      setClientes([...new Set((cliRes.data || []).map((r) => r.cliente))].sort());
      setPrestadores([...new Set((presRes.data || []).map((r) => r.prestador))].sort());
    })();
    return () => { ativo = false; };
  }, []);

  let filtrados = dados;
  if (busca.trim()) {
    const termo = busca.trim().toLowerCase();
    filtrados = filtrados.filter((r) =>
      (r.cnpj || "").toLowerCase().includes(termo) ||
      (r.numero_lote || "").toLowerCase().includes(termo) ||
      (r.nup || "").toLowerCase().includes(termo)
    );
  }

  const totalProcessados = dados.length;
  const lotesDistintos = new Set(dados.map((r) => r.numero_lote).filter(Boolean)).size;
  const nupsDistintos = new Set(dados.map((r) => r.nup).filter(Boolean)).size;

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

  useEffect(() => { setPagina(1); }, [busca, dataInicio, dataFim, filtroCliente, filtroPrestador]);

  function exportarExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["", "", "Total de informativos processados", totalProcessados],
      ["", "", "Lotes", lotesDistintos],
      ["", "", "NUPs", nupsDistintos],
      [],
      ["Cliente", "Prestador", "CNPJ", "Nº Lote", "NUP", "Mês Faturamento", "Arquivo", "Data"],
      ...filtrados.map((r) => [
        r.cliente,
        r.prestador,
        r.cnpj,
        r.numero_lote,
        r.nup,
        r.mes_faturamento,
        r.arquivo,
        formatarDataHora(r.created_at),
      ]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Informativos");
    XLSX.writeFile(wb, "informativos_faturamento.xlsx");
  }

  return (
    <>
      {/* CARDS */}
      <div className="cards">
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: "pointer" }}>
          <h3>Total Processados</h3>
          <p>{totalProcessados.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>no período filtrado</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: "pointer" }}>
          <h3>Lotes</h3>
          <p>{lotesDistintos.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>números de lote</p>
        </div>
        <div className="card animated-card" style={{ backgroundColor: cores.card, color: cores.texto, cursor: "pointer" }}>
          <h3>NUPs</h3>
          <p>{nupsDistintos.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>NUPs</p>
        </div>
      </div>

      {/* FILTROS */}
      <div className="filtro">
        <div className="linha-filtros">
          <div className="grupo-filtro">
            <label>Buscar:</label>
            <input
              className="filtro-processo"
              type="text"
              placeholder="CNPJ, Lote ou NUP"
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
            <label>Cliente:</label>
            <select
              className="filtro-processo"
              value={filtroCliente}
              onChange={(e) => setFiltroCliente(e.target.value)}
            >
              <option value="">Todos</option>
              {clientes.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="grupo-filtro">
            <label>Prestador:</label>
            <select
              className="filtro-processo"
              value={filtroPrestador}
              onChange={(e) => setFiltroPrestador(e.target.value)}
            >
              <option value="">Todos</option>
              {prestadores.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <button
            className="btn-tema"
            onClick={() => { setBusca(""); setDataInicio(""); setDataFim(""); setFiltroCliente(""); setFiltroPrestador(""); }}
          >
            <span className="material-symbols-outlined">mop</span>
            Limpar Filtros
          </button>
        </div>
      </div>

      {/* TABELA */}
      <div className="tabela-container" style={{ backgroundColor: cores.card, color: cores.texto, marginTop: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid rgba(128,128,128,0.2)" }}>
          <h3 style={{ margin: 0 }}>Detalhamento por Informativo</h3>
          <span style={{ fontSize: "13px", opacity: 0.8 }}>
            Mostrando {filtrados.length === 0 ? 0 : inicio + 1}—{Math.min(inicio + ITENS_POR_PAGINA, filtrados.length)} de {filtrados.length.toLocaleString("pt-BR")}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ color: cores.texto }}>Cliente</th>
                <th style={{ color: cores.texto }}>Prestador</th>
                <th style={{ color: cores.texto }}>CNPJ</th>
                <th style={{ color: cores.texto }}>Nº Lote</th>
                <th style={{ color: cores.texto }}>NUP</th>
                <th style={{ color: cores.texto }}>Mês Faturamento</th>
                <th style={{ color: cores.texto }}>Arquivo</th>
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
                  <td style={{ color: cores.texto }}>{r.prestador || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.cnpj || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.numero_lote || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.nup || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.mes_faturamento || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.arquivo || "—"}</td>
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
