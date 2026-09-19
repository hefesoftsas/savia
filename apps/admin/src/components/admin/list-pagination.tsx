import { cn } from "@/lib/utils";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  useListContext,
  useListPaginationContext,
  Translate,
  useTranslate,
} from "ra-core";

/**
 * A pagination component with page numbers and rows per page selector.
 *
 * Displays pagination controls with previous/next buttons, page numbers with ellipsis for long lists,
 * and a dropdown to change items per page. Works with List context.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/listpagination/ ListPagination documentation}
 *
 * @example
 * import { List, ListPagination } from '@/components/admin';
 *
 * const PostListPagination = () => (
 *   <ListPagination rowsPerPageOptions={[5, 10, 25]} />
 * );
 *
 * export const PostList = () => (
 *   <List pagination={<PostListPagination />}>
 *     // ...
 *   </List>
 * );
 */
export const ListPagination = ({
  rowsPerPageOptions = [5, 10, 25, 50],
  className,
}: {
  rowsPerPageOptions?: number[];
  className?: string;
}) => {
  const translate = useTranslate();
  const {
    hasPreviousPage,
    hasNextPage,
    page,
    perPage,
    setPerPage,
    total,
    setPage,
  } = useListPaginationContext();
  const { data = [] } = useListContext();

  const hasKnownTotal = typeof total === "number" && total >= 0;
  const isEmpty = data.length === 0 && (!hasKnownTotal || total === 0);
  const pageStart = (page - 1) * perPage + 1;
  const pageEnd = hasKnownTotal
    ? Math.min(page * perPage, total)
    : hasNextPage
      ? page * perPage
      : pageStart + Math.max(data.length, 1) - 1;
  const rangeTranslationKey = isEmpty
    ? "ra.navigation.empty_page_range_info"
    : hasKnownTotal
      ? "ra.navigation.page_range_info"
      : hasNextPage
        ? "ra.navigation.partial_page_range_info"
        : "ra.navigation.visible_page_range_info";

  const boundaryCount = 1;
  const siblingCount = 1;
  const count = total ? Math.ceil(total / perPage) : 1;

  const range = (start: number, end: number) => {
    const length = end - start + 1;
    return Array.from({ length }, (_, i) => start + i);
  };

  const startPages = range(1, Math.min(boundaryCount, count));
  const endPages = range(
    Math.max(count - boundaryCount + 1, boundaryCount + 1),
    count,
  );

  const siblingsStart = Math.max(
    Math.min(
      // Natural start
      page - siblingCount,
      // Lower boundary when page is high
      count - boundaryCount - siblingCount * 2 - 1,
    ),
    // Greater than startPages
    boundaryCount + 2,
  );

  const siblingsEnd = Math.min(
    Math.max(
      // Natural end
      page + siblingCount,
      // Upper boundary when page is low
      boundaryCount + siblingCount * 2 + 2,
    ),
    // Less than endPages
    count - boundaryCount - 1,
  );

  const siblingPages = range(siblingsStart, siblingsEnd);

  const pageChangeHandler = (newPage: number) => {
    return (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      setPage(newPage);
    };
  };
  const previousLabel = translate("ra.navigation.previous", {
    _: "Página anterior",
  });
  const nextLabel = translate("ra.navigation.next", { _: "Página siguiente" });

  return (
    <div
      className={cn(
        "flex min-w-0 w-full max-w-full flex-wrap items-center justify-end gap-2 sm:gap-4",
        className,
      )}
    >
      <div className="hidden md:flex items-center space-x-2">
        <p className="text-sm font-medium">
          <Translate i18nKey="ra.navigation.page_rows_per_page">
            Rows per page
          </Translate>
        </p>
        <Select
          value={perPage.toString()}
          onValueChange={(value) => {
            setPerPage(Number(value));
          }}
        >
          <SelectTrigger className="h-8 w-fit">
            <SelectValue placeholder={perPage} />
          </SelectTrigger>
          <SelectContent side="top">
            {rowsPerPageOptions.map((pageSize) => (
              <SelectItem key={pageSize} value={`${pageSize}`}>
                {pageSize}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-muted-foreground">
        <Translate
          i18nKey={rangeTranslationKey}
          options={{
            offsetBegin: pageStart,
            offsetEnd: pageEnd,
            total: hasKnownTotal ? total : pageEnd,
          }}
        >
          {isEmpty
            ? "0 results"
            : hasKnownTotal
              ? `${pageStart}-${pageEnd} of ${total}`
              : `${pageStart}-${pageEnd} results`}
        </Translate>
      </div>
      <Pagination className="-w-full -mx-auto">
        <PaginationContent>
          <PaginationItem>
            {hasPreviousPage ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <PaginationLink
                    href="#"
                    onClick={pageChangeHandler(page - 1)}
                    aria-label={previousLabel}
                  >
                    <ChevronLeftIcon />
                  </PaginationLink>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {previousLabel}
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium size-9">
                <ChevronLeftIcon
                  aria-label={previousLabel}
                  size="16"
                  className="text-muted-foreground"
                />
              </span>
            )}
          </PaginationItem>
          {startPages.map((pageNumber) => (
            <PaginationItem key={pageNumber}>
              <PaginationLink
                href="#"
                onClick={pageChangeHandler(pageNumber)}
                isActive={pageNumber === page}
              >
                {pageNumber}
              </PaginationLink>
            </PaginationItem>
          ))}
          {siblingsStart > boundaryCount + 2 ? (
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          ) : boundaryCount + 1 < count - boundaryCount ? (
            <PaginationItem>
              <PaginationLink
                href="#"
                onClick={pageChangeHandler(boundaryCount + 1)}
                isActive={boundaryCount + 1 === page}
              >
                {boundaryCount + 1}
              </PaginationLink>
            </PaginationItem>
          ) : null}
          {siblingPages.map((pageNumber) => (
            <PaginationItem key={pageNumber}>
              <PaginationLink
                href="#"
                onClick={pageChangeHandler(pageNumber)}
                isActive={pageNumber === page}
              >
                {pageNumber}
              </PaginationLink>
            </PaginationItem>
          ))}
          {siblingsEnd < count - boundaryCount - 1 ? (
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          ) : count - boundaryCount > boundaryCount ? (
            <PaginationItem>
              <PaginationLink
                href="#"
                onClick={pageChangeHandler(count - boundaryCount)}
                isActive={count - boundaryCount === page}
              >
                {count - boundaryCount}
              </PaginationLink>
            </PaginationItem>
          ) : null}
          {endPages.map((pageNumber) => (
            <PaginationItem key={pageNumber}>
              <PaginationLink
                href="#"
                onClick={pageChangeHandler(pageNumber)}
                isActive={pageNumber === page}
              >
                {pageNumber}
              </PaginationLink>
            </PaginationItem>
          ))}
          <PaginationItem>
            {hasNextPage ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <PaginationLink
                    href="#"
                    onClick={pageChangeHandler(page + 1)}
                    size="default"
                    className={cn(
                      "gap-1 px-2.5 sm:pr-2.5",
                      !hasNextPage ? "opacity-50 cursor-not-allowed" : "",
                    )}
                    aria-label={nextLabel}
                  >
                    <ChevronRightIcon />
                  </PaginationLink>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {nextLabel}
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium size-9">
                <ChevronRightIcon
                  aria-label={nextLabel}
                  size="16"
                  className="text-muted-foreground"
                />
              </span>
            )}
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
};
