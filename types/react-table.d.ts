/**
 * Type augmentation for @tanstack/react-table Row type.
 * Allows direct property access on row objects in cell renderers.
 */
import "@tanstack/react-table";

declare module "@tanstack/react-table" {
  interface Row<TData> {
    [key: string]: any;
  }
}
