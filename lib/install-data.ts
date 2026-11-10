export type InstallPackage = {
  id: string;
  name: string;
  unit: string;
  dueAt: string;
  publishedAt: string | null;
  version: string;
};
export type Item = {
  id: string;
  playId: string | null;
  title: string;
  group: string;
  reviewCount: number;
  complete: number;
  materialSource?: 'published' | 'legacy-live' | 'draft';
  material?: import('@/lib/install-material').InstallMaterial | null;
};
export type Review = {
  id: string;
  itemId: string;
  athleteId: string;
  name: string;
  position: string;
  reviewed: boolean;
  assignment: boolean;
  note: boolean;
  acknowledged: boolean;
};
export type Payload = {
  packages: InstallPackage[];
  package: InstallPackage | null;
  items: Item[];
  reviews: Review[];
};

export function parseInstallPayload(value: unknown, requestedId = ''): Payload {
  const data = value as Payload | null;
  const string = (value: unknown): value is string => typeof value === 'string';
  const unique = (items: { id: string }[]) =>
    new Set(items.map((item) => item.id)).size === items.length;
  const validPackage = (pack: InstallPackage) =>
    pack &&
    string(pack.id) &&
    Boolean(pack.id) &&
    string(pack.name) &&
    ['Team', 'Offence', 'Defence', 'Special teams'].includes(pack.unit) &&
    string(pack.dueAt) &&
    (pack.publishedAt === null || string(pack.publishedAt)) &&
    /^[a-f0-9]{64}$/.test(pack.version);
  if (
    !data ||
    !Array.isArray(data.packages) ||
    !data.packages.every(validPackage) ||
    !unique(data.packages) ||
    !Array.isArray(data.items) ||
    !Array.isArray(data.reviews) ||
    (data.package !== null &&
      (!validPackage(data.package) ||
        !data.packages.some((pack) => pack.id === data.package!.id))) ||
    (requestedId && data.package?.id !== requestedId) ||
    (!data.package &&
      (data.packages.length || data.items.length || data.reviews.length))
  )
    throw new Error(
      'The install response was incomplete. Reload before changing any data.',
    );
  if (
    !data.items.every(
      (item) =>
        item &&
        string(item.id) &&
        (item.playId === null || string(item.playId)) &&
        string(item.title) &&
        string(item.group) &&
        (item.materialSource === undefined ||
          ['published', 'legacy-live', 'draft'].includes(
            item.materialSource,
          )) &&
        (item.materialSource !== 'published' ||
          Boolean(
            item.material &&
            string(item.material.id) &&
            string(item.material.name) &&
            string(item.material.notes) &&
            Array.isArray(item.material.assignments) &&
            (item.playId === null || item.material.id === item.playId),
          )) &&
        Number.isInteger(item.reviewCount) &&
        item.reviewCount >= 0 &&
        Number.isFinite(item.complete) &&
        item.complete >= 0 &&
        item.complete <= 100,
    ) ||
    !unique(data.items)
  )
    throw new Error('Saved install plays could not be read. Please reload.');
  if (
    !data.reviews.every(
      (review) =>
        review &&
        string(review.id) &&
        string(review.athleteId) &&
        data.items.some((item) => item.id === review.itemId) &&
        string(review.name) &&
        string(review.position) &&
        [
          review.reviewed,
          review.assignment,
          review.note,
          review.acknowledged,
        ].every((flag) => typeof flag === 'boolean') &&
        review.acknowledged ===
          (review.reviewed && review.assignment && review.note),
    ) ||
    !unique(data.reviews)
  )
    throw new Error('Saved install reviews could not be read. Please reload.');
  return data;
}
