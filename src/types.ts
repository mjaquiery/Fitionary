/** Suggested sets and reps. `reps` is free text such as "8-12", "30s hold" or "10 min". */
export interface DefaultReps {
  sets: number;
  reps: string;
}

/** Normalized exercise record, as written to src/data/exercises.json by scripts/fetch-data.ts. */
export interface Exercise {
  id: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string;
  level: string;
  category: string;
  instructions: string[];
  /** Site-absolute paths under /exercises/, e.g. "/exercises/Air_Bike/0.jpg". */
  images: string[];
  defaultReps: DefaultReps;
}

/** Provenance written alongside the data to src/data/meta.json. */
export interface DataMeta {
  source: string;
  repository: string;
  /** Upstream commit SHA the data and images were taken from. */
  ref: string;
  license: string;
  exerciseCount: number;
  imageCount: number;
}
