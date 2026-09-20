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

  // Latest mode: pick the newest N first, then let the other filters narrow that set.
  // (The reverse — newest N of the filtered set — would turn "latest 100" into a
  // different 100 for every filter, and the count would never shrink.)
  // The selection is newest-first (urlUpdatedAt, then internal ID); the requested
  // direction is applied at the end so the members never change with the direction.
  if (options.latestCount && !options.randomCount) {
    filtered = selectLatestEntries(filtered, options.latestCount, false);
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
    // Already selected and ordered newest-first above; only the direction is left.
    // The regular sort below keys on displaySerial, which worlds and
    // avatars number independently, so it interleaves two unrelated
    // sequences and can never answer "what was added most recently".
    if (sortAsc) {
      filtered.reverse();
    }
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
