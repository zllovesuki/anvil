import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export const Breadcrumbs = ({ items }: BreadcrumbsProps) => (
  <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-zinc-500">
    {items.map((item, index) => {
      const isLast = index === items.length - 1;

      return (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          {index > 0 ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-zinc-600" /> : null}
          {item.href && !isLast ? (
            <Link to={item.href} className="transition-colors hover:text-zinc-200">
              {item.label}
            </Link>
          ) : (
            <span aria-current={isLast ? "page" : undefined} className={isLast ? "text-zinc-200" : ""}>
              {item.label}
            </span>
          )}
        </span>
      );
    })}
  </nav>
);
