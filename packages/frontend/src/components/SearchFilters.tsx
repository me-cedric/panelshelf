import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CatalogFilters, Source } from "../types/index.ts";
import { fetchFilterValues } from "../api/client.ts";
import {
  X,
  Building2,
  Layers,
  FileType,
  Globe,
  Database,
  Download,
  CalendarDays,
  Clock,
} from "lucide-react";

interface SearchFiltersProps {
  filters: CatalogFilters;
  sources: Source[];
  onChange: (filters: Partial<CatalogFilters>) => void;
}

export default function SearchFilters({ filters, sources, onChange }: SearchFiltersProps) {
  const { data: publishers } = useQuery({
    queryKey: ["filter-values", "publisher"],
    queryFn: () => fetchFilterValues("publisher"),
  });

  const { data: formats } = useQuery({
    queryKey: ["filter-values", "format"],
    queryFn: () => fetchFilterValues("format"),
  });

  const { data: languages } = useQuery({
    queryKey: ["filter-values", "language"],
    queryFn: () => fetchFilterValues("language"),
  });

  const { data: series } = useQuery({
    queryKey: ["filter-values", "series"],
    queryFn: () => fetchFilterValues("series"),
  });

  const clearFilters = useCallback(() => {
    onChange({
      publisher: undefined,
      series: undefined,
      language: undefined,
      format: undefined,
      sourceId: undefined,
      downloadAvailable: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      addedFrom: undefined,
      addedTo: undefined,
    });
  }, [onChange]);

  const hasActiveFilters = filters.publisher || filters.series || filters.language ||
    filters.format || filters.sourceId || filters.downloadAvailable !== undefined ||
    filters.dateFrom || filters.dateTo || filters.addedFrom || filters.addedTo;

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">Filters</h3>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="btn-ghost btn-xs text-red-400 hover:text-red-300">
            <X className="w-3 h-3" />
            Clear all
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {/* Publisher */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <Building2 className="w-3 h-3" />
            Publisher
          </label>
          <select
            className="select text-xs"
            value={filters.publisher || ""}
            onChange={(e) => onChange({ publisher: e.target.value || undefined })}
          >
            <option value="">All</option>
            {publishers?.values?.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Series */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <Layers className="w-3 h-3" />
            Series
          </label>
          <input
            type="text"
            className="input text-xs"
            placeholder="Series name..."
            value={filters.series || ""}
            onChange={(e) => onChange({ series: e.target.value || undefined })}
          />
        </div>

        {/* Format */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <FileType className="w-3 h-3" />
            Format
          </label>
          <select
            className="select text-xs"
            value={filters.format || ""}
            onChange={(e) => onChange({ format: e.target.value || undefined })}
          >
            <option value="">All</option>
            {formats?.values?.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        {/* Language */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <Globe className="w-3 h-3" />
            Language
          </label>
          <select
            className="select text-xs"
            value={filters.language || ""}
            onChange={(e) => onChange({ language: e.target.value || undefined })}
          >
            <option value="">All</option>
            {languages?.values?.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>

        {/* Source */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <Database className="w-3 h-3" />
            Source
          </label>
          <select
            className="select text-xs"
            value={filters.sourceId || ""}
            onChange={(e) => onChange({ sourceId: e.target.value || undefined })}
          >
            <option value="">All</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Download availability */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <Download className="w-3 h-3" />
            Download
          </label>
          <select
            className="select text-xs"
            value={filters.downloadAvailable === undefined ? "" : filters.downloadAvailable ? "true" : "false"}
            onChange={(e) => {
              if (e.target.value === "") onChange({ downloadAvailable: undefined });
              else onChange({ downloadAvailable: e.target.value === "true" });
            }}
          >
            <option value="">All</option>
            <option value="true">Available</option>
            <option value="false">Not Available</option>
          </select>
        </div>

        {/* Release date from */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            Release from
          </label>
          <input
            type="date"
            className="input text-xs"
            value={filters.dateFrom || ""}
            onChange={(e) => onChange({ dateFrom: e.target.value || undefined })}
          />
        </div>

        {/* Release date to */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            Release to
          </label>
          <input
            type="date"
            className="input text-xs"
            value={filters.dateTo || ""}
            onChange={(e) => onChange({ dateTo: e.target.value || undefined })}
          />
        </div>

        {/* Added from */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Added from
          </label>
          <input
            type="date"
            className="input text-xs"
            value={filters.addedFrom || ""}
            onChange={(e) => onChange({ addedFrom: e.target.value || undefined })}
          />
        </div>

        {/* Added to */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Added to
          </label>
          <input
            type="date"
            className="input text-xs"
            value={filters.addedTo || ""}
            onChange={(e) => onChange({ addedTo: e.target.value || undefined })}
          />
        </div>
      </div>
    </div>
  );
}
