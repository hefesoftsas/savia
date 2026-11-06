import { useEffect, useState } from "react";
/** Keep typing immediate while coalescing expensive collection search queries. */
export function useDebouncedSearch(value: string) {
  const [query, setQuery] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(value), 180);
    return () => clearTimeout(timer);
  }, [value]);
  return query;
}
