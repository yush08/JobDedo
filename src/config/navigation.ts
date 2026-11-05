import {
  LayoutDashboard,
  Search,
  Bookmark,
  FileText,
  ScanSearch,
  Mail,
  ListChecks,
  BarChart3,
  User,
  SlidersHorizontal,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Marks items that ship in a later milestone (still navigable). */
  badge?: string;
}

export const MAIN_NAV: NavItem[] = [
  { label: "Overview", href: "/overview", icon: LayoutDashboard },
  { label: "Discover Jobs", href: "/discover", icon: Search },
  { label: "Saved Jobs", href: "/saved", icon: Bookmark },
  { label: "Resume Studio", href: "/resume", icon: FileText },
  { label: "ATS Analyzer", href: "/ats", icon: ScanSearch },
  {
    label: "Cold Email Assistant",
    href: "/outreach",
    icon: Mail,
  },
  { label: "Applications", href: "/applications", icon: ListChecks },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
];

export const BOTTOM_NAV: NavItem[] = [
  { label: "My Profile", href: "/profile", icon: User },
  { label: "Preferences", href: "/preferences", icon: SlidersHorizontal },
  { label: "Settings", href: "/settings", icon: Settings },
];

export const ALL_NAV = [...MAIN_NAV, ...BOTTOM_NAV];
