import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchCatalogItem, enqueueDownload } from "../api/client.ts";
import { useMutationWithToast } from "../hooks/useMutationWithToast.ts";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Copy,
  BookOpen,
  Calendar,
  HardDrive,
  Tag,
  Globe,
  FileText,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

export default function ComicDetail() {
  const { id } = useParams<{ id: string }>();
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [enqueuingId, setEnqueuingId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["catalog-item", id],
    queryFn: () => fetchCatalogItem(id!),
    enabled: !!id,
  });

  const handleCopyLink = async (url: string, linkId: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyingId(linkId);
      setTimeout(() => setCopyingId(null), 2000);
    } catch {}
  };

  const enqueueMutation = useMutationWithToast({
    mutationFn: enqueueDownload,
    toast: {
      success: { message: "Download queued", description: "Check the Downloads page for progress" },
      error: (err: Error) => ({ message: "Failed to queue download", description: err.message }),
    },
  });

  const handleEnqueue = (downloadLinkId: string) => {
    setEnqueuingId(downloadLinkId);
    enqueueMutation.mutate(downloadLinkId, {
      onSettled: () => {
        setTimeout(() => setEnqueuingId(null), 600);
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-panel-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-lg font-medium text-gray-300">Item not found</p>
        <Link to="/" className="text-panel-400 hover:underline mt-2 inline-block">
          Back to catalog
        </Link>
      </div>
    );
  }

  const { item, links } = data;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back button */}
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to catalog
      </Link>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Cover */}
        <div className="w-full lg:w-72 shrink-0">
          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-gray-800 shadow-xl">
            {item.coverUrl ? (
              <img
                src={item.coverUrl}
                alt={item.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <BookOpen className="w-16 h-16 text-gray-700" />
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{item.title}</h1>
            {item.series && (
              <p className="text-lg text-gray-400 mt-1">
                {item.series}
                {item.issueNumber && <span> #{item.issueNumber}</span>}
                {item.volume && <span> (Vol. {item.volume})</span>}
              </p>
            )}
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {item.publisher && (
              <div className="card p-3">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <BookOpen className="w-3 h-3" />
                  Publisher
                </div>
                <p className="text-sm text-gray-200 font-medium">{item.publisher}</p>
              </div>
            )}
            {item.releaseDate && (
              <div className="card p-3">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <Calendar className="w-3 h-3" />
                  Release Date
                </div>
                <p className="text-sm text-gray-200 font-medium">{item.releaseDate}</p>
              </div>
            )}
            {item.format && (
              <div className="card p-3">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <FileText className="w-3 h-3" />
                  Format
                </div>
                <p className="text-sm text-gray-200 font-medium">{item.format}</p>
              </div>
            )}
            {item.fileSize && (
              <div className="card p-3">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <HardDrive className="w-3 h-3" />
                  File Size
                </div>
                <p className="text-sm text-gray-200 font-medium">{item.fileSize}</p>
              </div>
            )}
            {item.language && (
              <div className="card p-3">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <Globe className="w-3 h-3" />
                  Language
                </div>
                <p className="text-sm text-gray-200 font-medium">{item.language}</p>
              </div>
            )}
            {item.tags && (
              <div className="card p-3 col-span-2 sm:col-span-3">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1.5">
                  <Tag className="w-3 h-3" />
                  Tags
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {JSON.parse(item.tags).map((tag: string, i: number) => (
                    <span key={i} className="badge-gray text-[10px]">{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          {item.description && (
            <div className="card p-4">
              <h3 className="text-sm font-medium text-gray-200 mb-2">Description</h3>
              <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line line-clamp-6">
                {item.description}
              </p>
            </div>
          )}

          {/* Source link */}
          {item.detailUrl && (
            <a
              href={item.detailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary btn-sm inline-flex"
            >
              <ExternalLink className="w-4 h-4" />
              Open source page
            </a>
          )}

          {/* Download links */}
          {links.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <Download className="w-5 h-5 text-emerald-400" />
                Download Links ({links.length})
              </h2>
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-900/80 border-b border-gray-800">
                      <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Provider</th>
                      <th className="text-left px-4 py-2.5 text-gray-400 font-medium">File</th>
                      <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Size</th>
                      <th className="text-center px-4 py-2.5 text-gray-400 font-medium">Direct DL</th>
                      <th className="text-center px-4 py-2.5 text-gray-400 font-medium">Manual</th>
                      <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {links.map((link) => (
                      <tr key={link.id} className="hover:bg-gray-900/50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-200">{link.provider}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 max-w-[200px] truncate">
                          {link.fileName || "-"}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{link.size || "-"}</td>
                        <td className="px-4 py-3 text-center">
                          {link.directDownloadCapable ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                          ) : (
                            <CloseIcon className="w-4 h-4 text-gray-600 mx-auto" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {link.manualActionRequired ? (
                            <AlertCircle className="w-4 h-4 text-yellow-400 mx-auto" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleCopyLink(link.url, `copy-${link.id}`)}
                              className="btn-ghost btn-xs"
                              title="Copy link"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            {link.directDownloadCapable && (
                              <button
                                onClick={() => handleEnqueue(link.id)}
                                className="btn-primary btn-xs"
                                disabled={enqueuingId === link.id}
                              >
                                {enqueuingId === link.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Download className="w-3 h-3" />
                                )}
                                Download
                              </button>
                            )}
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-ghost btn-xs"
                              title="Open in browser"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* No download links */}
          {links.length === 0 && (
            <div className="card p-6 text-center">
              <Download className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No download links available for this item</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
