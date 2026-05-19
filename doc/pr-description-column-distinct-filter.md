# PR Description

## Summary

Adds a variable-level filtering workflow in the dataset viewer by extending the existing column context menu.

Key changes:

- Adds a new `Filter by values` submenu in the column header context menu.
- Loads distinct values for the selected column and allows users to apply a filter by selecting one of those values.
- Adds `Clear filter for this column` support.
- Preserves compatibility with existing free-form filter expressions and combines them with column-level filters.
- Implements backend support for distinct-value retrieval in both REST and ITC adapters.

Implementation notes:

- Webview message flow extended with `request:loadDistinctValues` / `response:loadDistinctValues`.
- Query model now supports optional `columnFilters` in addition to `filterValue`.
- ITC script now supports `GetDistinctColumnValues` and combines multiple where clauses safely.

## Testing

Added/updated automated tests:

- `client/test/components/LibraryNavigator/LibraryDataProvider.test.ts`
  - Verifies distinct values are de-duplicated and returned correctly.
  - Verifies combined where-clause generation from expression filter + column filters.
- `client/test/connection/itc/ItcLibraryAdapter.test.ts`
  - Verifies ITC adapter returns parsed distinct column values.

Validation status:

- Type diagnostics on changed files passed.
- Full npm task execution was not run in this environment because `npm` is not available in PATH.

## TODOs

- [ ] Add any supporting documentation and (optionally) update [CHANGELOG.md](../CHANGELOG.md)
