import type { AkyoData, AkyoFilterOptions } from "@/types/akyo";
import { getDisplaySerialNumber, resolveEntryType, selectLatestEntries } from "./akyo-entry";
import { buildCatalogSearchIndex, normalizeCatalogSearchValue, parseCatalogMultiValueField } from "./catalog-preparation";

export function filterCatalog(data: readonly AkyoData[], options: AkyoFilterOptions, sortAsc = true): AkyoData[] {
  const normalizedQueryVariants = normalizeCatalogSearchValue(
    options.searchQuery,
  );
  const targetCategory = options.category || options.attribute;
  const targetAuthor = options.author || options.creator;
  const createSelectedList = (
    values: string[] | undefined,
    singleValue: string | undefined,
  ) =>
    (values && values.length > 0
      ? values
      : singleValue && singleValue !== "all"
        ? [singleValue]
        : []
    )
      .map((item) => item.trim())
      .filter(Boolean);

  const selectedAuthors = createSelectedList(options.authors, targetAuthor);
  const selectedCategories = createSelectedList(
    options.categories,
    targetCategory,
  );
  const categoryMatchMode =
    options.categoryMatchMode === "and" ? "and" : "or";

  let filtered = [...data];

  // Filter by entry type (avatar / world)
  if (options.entryTypeFilter) {
    filtered = filtered.filter(
      (akyo) => resolveEntryType(akyo) === options.entryTypeFilter,
    );
  }

  // Filter by categories (supports both single and multi-select)
  if (selectedCategories.length > 0) {
    filtered = filtered.filter((akyo) => {
      const parsedCategories =
        akyo.parsedCategory ??
        parseCatalogMultiValueField(akyo.category || akyo.attribute || "");

      if (categoryMatchMode === "and") {
        return selectedCategories.every((category) =>
          parsedCategories.includes(category),
        );
      }
      return selectedCategories.some((category) =>
        parsedCategories.includes(category),
      );
    });
  }

  // Filter by creator/author
  if (selectedAuthors.length > 0) {
    filtered = filtered.filter((akyo) => {
      const parsedAuthors =
        akyo.parsedAuthor ??
        parseCatalogMultiValueField(akyo.author || akyo.creator || "");
      return selectedAuthors.some((author) =>
        parsedAuthors.includes(author),
      );
    });
  }

  // Filter by favorites
  if (options.favoritesOnly) {
    filtered = filtered.filter((akyo) => akyo.isFavorite);
  }

  // Filter by search query (using pre-computed _searchIndex for performance)
  if (normalizedQueryVariants.length > 0) {
    filtered = filtered.filter((akyo) => {
      const normalizedTargets =
        akyo._searchIndex ?? buildCatalogSearchIndex(akyo);

      return normalizedQueryVariants.some((query) =>
        normalizedTargets.some((target) => target.includes(query)),
      );
    });
  }

  // Random display mode
  if (options.randomCount) {
    filtered = filtered
      .map((value) => ({ value, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ value }) => value)
      .slice(0, options.randomCount);
  } else if (options.latestCount) {
    // Select the newest internal IDs first, then apply the requested direction.
    // The regular sort below keys on displaySerial, which worlds and
    // avatars number independently, so it interleaves two unrelated
    // sequences and can never answer "what was added most recently".
    filtered = selectLatestEntries(filtered, options.latestCount, sortAsc);
  } else {
    // Sort by display serial for worlds, by ID for avatars
    filtered.sort((a, b) => {
      const serialA = getDisplaySerialNumber(a);
      const serialB = getDisplaySerialNumber(b);
      const idA = serialA ?? (Number.parseInt(a.id, 10) || 0);
      const idB = serialB ?? (Number.parseInt(b.id, 10) || 0);
      return sortAsc ? idA - idB : idB - idA;
    });
  }

  return filtered;
}
