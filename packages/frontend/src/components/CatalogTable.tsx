import React from "react";
import { Link } from "react-router-dom";
import type { CatalogItem } from "../types/index.ts";
import { Download, Calendar, HardDrive, BookOpen } from "lucide-react";

interface CatalogTableProps {
  items: CatalogItem[];
}

const CatalogTable: React.FC<CatalogTableProps> = ({ items }) => {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-900/80 border-b border-gray-800">
            <th className="text-left px-4 py-3 text-gray-400 font-medium">Title</th>
            <th className="text-left px-4 py-3 text-gray-400 font-medium">Publisher</th>
            <th className="text-left px-4 py-3 text-gray-400 font-medium">Format</th>
            <th className="text-left px-4 py-3 text-gray-400 font-medium">Size</th>
            <th className="text-left px-4 py-3 text-gray-400 font-medium">Release</th>
            <th className="text-center px-4 py-3 text-gray-400 font-medium">DL</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {items.map((item) => (
            <tr
              key={item.id}
              className="hover:bg-gray-900/50 transition-colors group"
            >
              <td className="px-4 py-3">
                <Link
                  to={`/catalog/${item.id}`}
                  className="text-gray-200 hover:text-panel-400 transition-colors font-medium line-clamp-1"
                >
                  {item.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-gray-400">{item.publisher || "-"}</td>
              <td className="px-4 py-3">
                {item.format ? (
                  <span className="badge-gray text-[10px]">{item.format}</span>
                ) : (
                  <span className="text-gray-600">-</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="flex items-center gap-1 text-gray-400">
                  <HardDrive className="w-3 h-3" />
                  {item.fileSize || "-"}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="flex items-center gap-1 text-gray-400">
                  <Calendar className="w-3 h-3" />
                  {item.releaseDate || "-"}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                {item.downloadAvailable ? (
                  <Download className="w-4 h-4 text-emerald-400 mx-auto" />
                ) : (
                  <span className="text-gray-700">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default React.memo(CatalogTable);
