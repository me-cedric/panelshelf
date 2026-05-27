import { Globe, Archive, FolderOpen } from "lucide-react";

export const PROVIDER_ICONS: Record<string, any> = {
  getcomics: Globe,
  digitalcomicmuseum: Archive,
  zipcomic: FolderOpen,
  internetarchive: Archive,
};

export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  getcomics:
    "Scrapes getcomics.org for the latest DC, Marvel, and indie comic releases with download links.",
  digitalcomicmuseum:
    "Browses the Digital Comic Museum archive of public domain golden-age comics.",
  zipcomic:
    "Scrapes ZipComic for downloadable comic book collections and series bundles.",
  internetarchive:
    "Searches archive.org for comics using the Internet Archive's public API and metadata.",
};
