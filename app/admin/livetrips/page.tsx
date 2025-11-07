useEffect(() => {
  const un = subscribeDriverLocations((evt) => {
    setDrivers((prev) => {
      if (evt.type === "DELETE" && evt.old) return prev.filter((d) => d.id !== evt.old.id);
      if (!evt.new) return prev;
      const i = prev.findIndex((d) => d.id === evt.new!.id);
      if (i === -1) return [evt.new!, ...prev];
      const next = [...prev];
      next[i] = evt.new!;
      return next;
    });
  });

  return un; // <-- returns () => void (sync)
}, []);
