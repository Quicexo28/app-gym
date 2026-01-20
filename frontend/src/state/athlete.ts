import { useEffect, useState } from "react";

const KEY = "coach_ai_athlete_id_v1";

export function useAthleteId(): [string, (id: string) => void] {
  const [athleteId, setAthleteIdState] = useState<string>(() => {
    const v = localStorage.getItem(KEY);
    return v && v.trim() ? v : "a1";
  });

  useEffect(() => {
    localStorage.setItem(KEY, athleteId);
  }, [athleteId]);

  function setAthleteId(id: string) {
    setAthleteIdState(id.trim() || "a1");
  }

  return [athleteId, setAthleteId];
}
