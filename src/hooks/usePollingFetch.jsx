import { useState, useEffect, useCallback, useRef } from "react";

export function usePollingFetch(fetchFn, intervalMs = 120000, deps = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const fetchFnRef = useRef(fetchFn);
  const intervalRef = useRef(null);
  const abortRef = useRef(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    fetchFnRef.current = fetchFn;
  }, [fetchFn]);

  const fetchData = useCallback(async (isBackground = false) => {
    // Polls de fundo não se sobrepõem; fetches explícitos (mount/filtros)
    // sempre disparam, abortando o anterior — senão a lista fica presa em
    // "Carregando..." quando um fetch em voo é abortado pelo cleanup do effect.
    if (inFlightRef.current && isBackground) return;
    inFlightRef.current = true;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (isBackground) setUpdating(true);
    else setLoading(true);

    try {
      const result = await fetchFnRef.current(controller.signal);
      if (!controller.signal.aborted) setData(result);
    } catch (error) {
      if (error?.name !== "AbortError") console.error("Erro ao buscar dados:", error);
    } finally {
      // só o fetch mais recente libera o flag — um fetch abortado não pode
      // derrubar o flag de um novo que já esteja em voo
      if (abortRef.current === controller) inFlightRef.current = false;
      if (!controller.signal.aborted) {
        setLoading(false);
        setUpdating(false);
      }
    }
  }, []);

  const startInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => fetchData(true), intervalMs);
  }, [intervalMs, fetchData]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetchData(false);
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      startInterval();
    }
    return () => {
      stopInterval();
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, fetchData, ...deps]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchData(true);
        startInterval();
      } else {
        stopInterval();
        if (abortRef.current) abortRef.current.abort();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchData, startInterval, stopInterval]);

  const refresh = useCallback(() => {
    fetchData(true);
  }, [fetchData]);

  return { data, loading, updating, refresh };
}
