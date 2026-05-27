import React from "react";
import { Link } from "react-router-dom";
import type { CatalogItem } from "../types/index.ts";
import { Download, Calendar, BookOpen, HardDrive } from "lucide-react";

interface CatalogGridProps {
  items: CatalogItem[];
}

const CatalogGrid: React.FC<CatalogGridProps> = ({ items }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {items.map((item) => (
        <Link
          key={item.id}
          to={`/catalog/${item.id}`}
          className="card-hover group overflow-hidden"
        >
          {/* Cover */}
          <div className="aspect-[3/4] bg-gray-800 overflow-hidden relative">
            {item.coverUrl ? (
              <img
                src={item.coverUrl}
                alt={item.title}
                className="w-full h-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-105"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "";
                  (e.target as HTMLImageElement).classList.add("hidden");
                  const parent = (e.target as HTMLImageElement).parentElement;
                  if (parent) {
                    parent.classList.add("flex", "items-center", "justify-center");
                    const icon = document.createElement("div");
                    icon.className = "text-gray-600";
                    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M20 22H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20Z"/></svg>`;
                    parent.appendChild(icon);
                  }
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <BookOpen className="w-10 h-10 text-gray-700" />
              </div>
            )}

            {/* Download badge */}
            {item.downloadAvailable && (
              <div className="absolute top-2 right-2 bg-emerald-500/90 rounded-full p-1.5 shadow-lg">
                <Download className="w-3 h-3 text-white" />
              </div>
            )}

            {/* Format badge */}
            {item.format && (
              <div className="absolute top-2 left-2">
                <span className="badge-gray text-[10px] px-1.5 py-0.5 bg-gray-900/80">
                  {item.format}
                </span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-3 space-y-1.5">
            <h3 className="text-sm font-medium text-gray-200 line-clamp-2 leading-snug group-hover:text-panel-400 transition-colors">
              {item.title}
            </h3>
            {item.publisher && (
              <p className="text-xs text-gray-500">{item.publisher}</p>
            )}
            <div className="flex items-center gap-3 text-[11px] text-gray-600">
              {item.releaseDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {item.releaseDate}
                </span>
              )}
              {item.fileSize && (
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />
                  {item.fileSize}
                </span>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
};

export default React.memo(CatalogGrid);
