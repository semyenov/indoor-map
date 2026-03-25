import type {
  CanonicalIndoorDataset,
  FeatureLabelSourceId,
  FeatureSourceId,
  IndoorRuntimeDataset,
  OfficeFeature,
  OfficePolygonFeature,
} from "./types";
import { deriveIndoorRuntimeDataset } from "./derive-indoor-runtime";

export interface IndoorRuntimeIndexes {
  featureById: Map<string, OfficeFeature>;
  featureSourceById: Map<string, FeatureSourceId>;
  featureLabelSourceById: Map<string, FeatureLabelSourceId>;
  selectableSpaceFeatures: OfficePolygonFeature[];
}

export interface IndoorRuntimeData {
  dataset: IndoorRuntimeDataset;
  indexes: IndoorRuntimeIndexes;
}

const DATASET_URL = "/indoor-data.json";

const featureKey = (feature: { id?: string | number; properties: { featureId: string } }) =>
  typeof feature.id === "string" ? feature.id : feature.properties.featureId;

const isIndoorDataset = (value: unknown): value is CanonicalIndoorDataset => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value;

  if (!("levels" in candidate) || !Array.isArray(candidate.levels)) {
    return false;
  }

  if (!("grid" in candidate) || typeof candidate.grid !== "object" || candidate.grid === null) {
    return false;
  }

  if (!("rooms" in candidate) || !Array.isArray(candidate.rooms)) {
    return false;
  }

  if (!("pois" in candidate) || !Array.isArray(candidate.pois)) {
    return false;
  }

  if (!("structures" in candidate) || !Array.isArray(candidate.structures)) {
    return false;
  }

  return true;
};

export const buildIndoorRuntimeIndexes = (dataset: IndoorRuntimeDataset): IndoorRuntimeIndexes => {
  const featureById = new Map(dataset.features.map((feature) => [feature.id, feature]));
  const featureSourceById = new Map<string, FeatureSourceId>();
  const featureLabelSourceById = new Map<string, FeatureLabelSourceId>();

  for (const feature of dataset.collections.spaces.features) {
    featureSourceById.set(featureKey(feature), "spaces");
  }

  for (const feature of dataset.collections.structures.features) {
    featureSourceById.set(featureKey(feature), "structures");
  }

  for (const feature of dataset.collections.pois.features) {
    featureSourceById.set(featureKey(feature), "pois");
  }

  for (const feature of dataset.collections.roomLabels.features) {
    featureLabelSourceById.set(featureKey(feature), "room-label-points");
  }

  for (const feature of dataset.collections.poiLabels.features) {
    featureLabelSourceById.set(featureKey(feature), "poi-label-points");
  }

  const selectableSpaceFeatures = dataset.collections.spaces.features.filter(
    (feature): feature is OfficePolygonFeature =>
      feature.geometry.type === "Polygon" &&
      (feature.properties.kind === "room" ||
        feature.properties.kind === "meeting_room" ||
        feature.properties.kind === "amenity"),
  );

  return {
    featureById,
    featureSourceById,
    featureLabelSourceById,
    selectableSpaceFeatures,
  };
};

export const loadIndoorDataset = async (input: RequestInfo | URL = DATASET_URL): Promise<IndoorRuntimeData> => {
  const response = await fetch(input);

  if (!response.ok) {
    throw new Error(`Failed to load indoor dataset: ${response.status} ${response.statusText}`);
  }

  const datasetJson: unknown = await response.json();

  if (!isIndoorDataset(datasetJson)) {
    throw new Error("Loaded indoor dataset has an invalid shape.");
  }

  const runtimeDataset = deriveIndoorRuntimeDataset(datasetJson);

  return {
    dataset: runtimeDataset,
    indexes: buildIndoorRuntimeIndexes(runtimeDataset),
  };
};
