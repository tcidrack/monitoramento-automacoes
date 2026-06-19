import { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import "./App.css";
import Regulacoes from "./tabs/Regulacoes";
import ExecucoesRMTC from "./tabs/ExecucoesRMTC";
import AprovadorItens from "./tabs/AprovadorItens";
import ExecucoesTaxasOftalmo from "./tabs/ExecucoesTaxasOftalmo";
import Triagem from "./tabs/Triagem";
import InformativosFaturamento from "./tabs/InformativosFaturamento";

function Loader({ cor }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "40px" }}>
      <svg stroke={cor} viewBox="0 0 24 24" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
        <g>
          <circle cx="12" cy="12" r="9.5" fill="none" strokeWidth="3" strokeLinecap="round">
            <animate attributeName="stroke-dasharray" dur="1.5s"
              values="0 150;42 150;42 150;42 150" keyTimes="0;0.475;0.95;1" repeatCount="indefinite" />
            <animate attributeName="stroke-dashoffset" dur="1.5s"
              values="0;-16;-59;-59" keyTimes="0;0.475;0.95;1" repeatCount="indefinite" />
          </circle>
          <animateTransform attributeName="transform" type="rotate"
            dur="2s" values="0 12 12;360 12 12" repeatCount="indefinite" />
        </g>
      </svg>
    </div>
  );
}

const ABAS = [
  { path: "taxas-oftalmo",       label: "Taxas Oftalmo",          icon: "visibility" },
  { path: "rmtc",          label: "Deflator RM/TC",     icon: "percent_discount" },
  { path: "aprovador",     label: "Aprovador de Itens", icon: "check_circle" },
  { path: "regulacoes",    label: "Regulações",         icon: "assignment" },
  { path: "triagem", label: "Triagem", icon: "attach_file" },
  { path: "informativos", label: "Informativos", icon: "description" },
];

export default function App() {
  const [tema, setTema] = useState(() => localStorage.getItem("tema") || "claro");

  const cores = {
    claro: { fundo: "#0070FF", card: "#E5F0FF", texto: "#000" },
    escuro: { fundo: "#111827", card: "#1E293B", texto: "#fff" },
  };

  useEffect(() => {
    localStorage.setItem("tema", tema);
  }, [tema]);

  function trocarTema() {
    setTema(tema === "claro" ? "escuro" : "claro");
  }

  const coresAtivas = cores[tema];

  return (
    <div
      className={`container ${tema === "escuro" ? "tema-escuro" : "tema-claro"}`}
      style={{ backgroundColor: coresAtivas.fundo }}
    >
      {/* GOOGLE MATERIAL ICONS */}
      <link
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined"
        rel="stylesheet"
      />

      {/* HEADER */}
      <div className="header">
        <div className="logo-area">
          <img
            src="https://maida.health/wp-content/themes/melhortema/assets/images/logo-light.svg"
            alt="Logo Maida"
          />
          <h1>Monitoramento de Automações</h1>
        </div>

        <div className="acoes-header">
          <button className="btn-tema btn-tema-toggle" onClick={trocarTema}>
            <span className="material-symbols-outlined">
              {tema === "claro" ? "bedtime" : "brightness_7"}
            </span>
            {tema === "claro" ? "Escuro" : "Claro"}
          </button>
        </div>
      </div>

      {/* ABAS */}
      <div className="abas">
        {ABAS.map((aba) => (
          <NavLink
            key={aba.path}
            to={`/${aba.path}`}
            className={({ isActive }) => `aba-btn ${isActive ? "ativa" : ""}`}
          >
            <span className="material-symbols-outlined" style={{ marginRight: 0 }}>
              {aba.icon}
            </span>
            {aba.label}
          </NavLink>
        ))}
      </div>

      {/* CONTEÚDO DA ABA */}
      <Routes>
        <Route path="/" element={<Navigate to="/taxas-oftalmo" replace />} />
        <Route path="/regulacoes"    element={<Regulacoes tema={tema} cores={coresAtivas} />} />
        <Route path="/rmtc"          element={<ExecucoesRMTC tema={tema} cores={coresAtivas} />} />
        <Route path="/aprovador"     element={<AprovadorItens tema={tema} cores={coresAtivas} />} />
        <Route path="/taxas-oftalmo"       element={<ExecucoesTaxasOftalmo tema={tema} cores={coresAtivas} />} />
        <Route path="/triagem" element={<Triagem tema={tema} cores={coresAtivas} />} />
        <Route path="/informativos" element={<InformativosFaturamento tema={tema} cores={coresAtivas} />} />
        <Route path="*" element={<Navigate to="/taxas-oftalmo" replace />} />
      </Routes>
    </div>
  );
}
