/**
 * Common Helper Functions for Akyo Data Processing
 * 
 * This module provides reusable utility functions for extracting
 * categories, authors, and finding items in Akyo datasets.
 * Used by akyo-data.ts, akyo-data-server.ts, akyo-data-json.ts, and akyo-data-kv.ts
 * to avoid code duplication.
 */

import type { AkyoData } from '@/types/akyo';
export { getCategoryBadgeColors, getCategoryColor } from './category-colors';

/**
 * Delimiter pattern for splitting multi-value strings in CSV (comma or Japanese ideographic comma)
 */
const MULTI_VALUE_SPLIT_PATTERN = /[、,]/;

/**
 * Extract all unique categories from a dataset
 * Handles both 'category' and legacy 'attribute' fields
 * Supports both Japanese (、) and Western (,) delimiters
 * 
 * @param data - Array of Akyo data
 * @returns Sorted array of unique categories
 */
export function extractCategories(data: AkyoData[]): string[] {
  const categoriesSet = new Set<string>();

  data.forEach((akyo) => {
    const catStr = akyo.category || akyo.attribute || '';
    const cats = catStr.split(MULTI_VALUE_SPLIT_PATTERN).map((c) => c.trim()).filter(Boolean);
    cats.forEach((cat) => categoriesSet.add(cat));
  });

  return Array.from(categoriesSet).sort();
}

/**
 * Extract all unique authors from a dataset
 * Handles both 'author' and legacy 'creator' fields
 * Supports both Japanese (、) and Western (,) delimiters
 * 
 * @param data - Array of Akyo data
 * @returns Sorted array of unique authors
 */
export function extractAuthors(data: AkyoData[]): string[] {
  const authorsSet = new Set<string>();

  data.forEach((akyo) => {
    const authorStr = akyo.author || akyo.creator || '';
    const authors = authorStr
      .split(MULTI_VALUE_SPLIT_PATTERN)
      .map((a) => a.trim())
      .filter(Boolean);
    authors.forEach((author) => authorsSet.add(author));
  });

  return Array.from(authorsSet).sort();
}

/**
 * Parse category string and sort with the same logic as filter panel
 * (default JavaScript lexical sort).
 * 
 * @param category - Raw category string from data
 * @returns Sorted array of trimmed category strings
 */
export function parseAndSortCategories(category: string): string[] {
  return category
    .split(MULTI_VALUE_SPLIT_PATTERN)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
}

/**
 * Find a single Akyo item by ID
 * 
 * @param data - Array of Akyo data
 * @param id - 4-digit ID (e.g., "0001")
 * @returns Single Akyo data or null if not found
 */
export function findAkyoById(data: AkyoData[], id: string): AkyoData | null {
  return data.find((akyo) => akyo.id === id) || null;
}
