import { useVirtualizer, defaultRangeExtractor } from "@tanstack/react-virtual";
import type { ReactNode, Ref, ComponentProps } from "react";
import {
  Children,
  createElement,
  isValidElement,
  useCallback,
  useState,
} from "react";
import type {
  DataTableBaseProps,
  ExtractRecordPaths,
  HintedString,
  Identifier,
  RaRecord,
  SortPayload,
} from "ra-core";
import {
  DataTableBase,
  DataTableRenderContext,
  FieldTitle,
  RecordContextProvider,
  useDataTableCallbacksContext,
  useDataTableConfigContext,
  useDataTableDataContext,
  useDataTableRenderContext,
  useDataTableSelectedIdsContext,
  useDataTableSortContext,
  useDataTableStoreContext,
  useGetPathForRecordCallback,
  useRecordContext,
  useResourceContext,
  useStore,
  useTranslate,
  useTranslateLabel,
  useNavigate,
} from "ra-core";
import { ArrowDownAZ, ArrowUpDown, ArrowUpZA } from "lucide-react";
import get from "lodash/get";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ColumnsSelector,
  ColumnsSelectorItem,
} from "@/components/admin/columns-button";
import { NumberField } from "@/components/admin/number-field";
import {
  BulkActionsToolbar,
  BulkActionsToolbarChildren,
} from "@/components/admin/bulk-actions-toolbar";
import { Skeleton } from "@/components/ui/skeleton";

const defaultBulkActionButtons = <BulkActionsToolbarChildren />;

/**
 * A powerful data table with sorting, selection, and column customization.
 *
 * Displays records in a table with built-in support for column sorting, bulk selection, row clicks,
 * and column visibility controls. Use DataTable.Col to define columns.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/datatable/ DataTable documentation}
 *
 * @example
 * import { List, DataTable, ReferenceField, EditButton } from '@/components/admin';
 *
 * export const PostList = () => (
 *   <List>
 *     <DataTable>
 *       <DataTable.Col source="id" />
 *       <DataTable.Col label="User">
 *         <ReferenceField source="user_id" reference="users" />
 *       </DataTable.Col>
 *       <DataTable.Col source="title" />
 *       <DataTable.Col>
 *         <EditButton />
 *       </DataTable.Col>
 *     </DataTable>
 *   </List>
 * );
 */
export function DataTable<RecordType extends RaRecord = RaRecord>(
  props: DataTableProps<RecordType>,
) {
  const {
    children,
    className,
    rowClassName,
    bulkActionButtons = defaultBulkActionButtons,
    bulkActionsToolbar,
    scrollViewportRef,
    virtualize = false,
    rowOffset = 0,
    ...rest
  } = props;
  const [viewport, setViewportElement] = useState<HTMLDivElement | null>(null);
  const setViewport = useCallback(
    (node: HTMLDivElement | null) => {
      setViewportElement(node);
      if (typeof scrollViewportRef === "function") scrollViewportRef(node);
      else if (scrollViewportRef) scrollViewportRef.current = node;
    },
    [scrollViewportRef],
  );
  const hasBulkActions = !!bulkActionsToolbar || bulkActionButtons !== false;
  const resourceFromContext = useResourceContext(props);
  const storeKey = props.storeKey || `${resourceFromContext}.datatable`;
  const [columnRanks] = useStore<number[]>(`${storeKey}_columnRanks`);
  const columns = columnRanks
    ? reorderChildren(children, columnRanks)
    : children;

  const columnWidths = Children.toArray(columns).map((column) =>
    isValidElement<{ width?: number }>(column)
      ? (column.props.width ?? 200)
      : 200,
  );
  return (
    <DataTableBase<RecordType>
      hasBulkActions={hasBulkActions}
      loading={
        <DataTableLoading
          hasBulkActions={hasBulkActions}
          className={className}
        />
      }
      empty={<DataTableEmpty />}
      {...rest}
    >
      <div
        className={cn(
          "rounded-md border",
          virtualize &&
            "[&_[data-slot=table-container]]:max-h-[min(60vh,560px)] [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-background [&_td]:overflow-hidden [&_td]:text-ellipsis",
          className,
        )}
      >
        <Table
          ref={setViewport}
          style={
            virtualize
              ? {
                  tableLayout: "fixed",
                  width: columnWidths.reduce(
                    (a, b) => a + b,
                    hasBulkActions ? 40 : 0,
                  ),
                  minWidth: "100%",
                }
              : undefined
          }
          aria-rowcount={
            virtualize && rest.total !== undefined ? rest.total + 1 : undefined
          }
        >
          {virtualize && (
            <colgroup>
              {hasBulkActions && <col style={{ width: 40 }} />}
              {columnWidths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
          )}
          <DataTableRenderContext.Provider value="header">
            <DataTableHead>{columns}</DataTableHead>
          </DataTableRenderContext.Provider>
          {virtualize ? (
            <VirtualDataTableBody<RecordType>
              viewport={viewport}
              rowOffset={rowOffset}
              rowClassName={rowClassName}
            >
              {columns}
            </VirtualDataTableBody>
          ) : (
            <DataTableBody<RecordType>
              rowClassName={rowClassName}
              rowOffset={rowOffset}
            >
              {columns}
            </DataTableBody>
          )}
        </Table>
      </div>
      {bulkActionsToolbar ??
        (bulkActionButtons !== false && (
          <BulkActionsToolbar>
            {isValidElement(bulkActionButtons)
              ? bulkActionButtons
              : defaultBulkActionButtons}
          </BulkActionsToolbar>
        ))}
      <DataTableRenderContext.Provider value="columnsSelector">
        <ColumnsSelector>{children}</ColumnsSelector>
      </DataTableRenderContext.Provider>
    </DataTableBase>
  );
}

DataTable.Col = DataTableColumn;
DataTable.NumberCol = DataTableNumberColumn;

const DataTableHead = ({ children }: { children: ReactNode }) => {
  const data = useDataTableDataContext();
  const { hasBulkActions = false } = useDataTableConfigContext();
  const { onSelect } = useDataTableCallbacksContext();
  const selectedIds = useDataTableSelectedIdsContext();
  const handleToggleSelectAll = (checked: boolean) => {
    if (!onSelect || !data || !selectedIds) return;
    onSelect(
      checked
        ? selectedIds.concat(
            data
              .filter((record) => !selectedIds.includes(record.id))
              .map((record) => record.id),
          )
        : // We should only unselect the ids present in the current page
          selectedIds.filter((id) => !data.some((record) => record.id === id)),
    );
  };
  const selectableIds = Array.isArray(data)
    ? data.map((record) => record.id)
    : [];
  return (
    <TableHeader>
      <TableRow>
        {hasBulkActions ? (
          <TableHead className="w-8">
            <Checkbox
              onCheckedChange={handleToggleSelectAll}
              checked={
                selectedIds &&
                selectedIds.length > 0 &&
                selectableIds.length > 0 &&
                selectableIds.every((id) => selectedIds.includes(id))
              }
              className="mb-2"
            />
          </TableHead>
        ) : null}
        {children}
      </TableRow>
    </TableHeader>
  );
};

const DataTableBody = <RecordType extends RaRecord = RaRecord>({
  children,
  rowClassName,
  rowOffset = 0,
}: {
  rowOffset?: number;
  children: ReactNode;
  rowClassName?: (record: RecordType) => string | undefined;
}) => {
  const data = useDataTableDataContext();
  return (
    <TableBody>
      {data?.map((record, rowIndex) => (
        <RecordContextProvider
          value={record}
          key={record.id ?? `row${rowIndex}`}
        >
          <DataTableRow
            className={rowClassName?.(record)}
            aria-rowindex={rowOffset + rowIndex + 2}
          >
            {children}
          </DataTableRow>
        </RecordContextProvider>
      ))}
    </TableBody>
  );
};

const VirtualDataTableBody = <RecordType extends RaRecord = RaRecord>({
  children,
  rowClassName,
  viewport,
  rowOffset,
}: {
  children: ReactNode;
  rowClassName?: (record: RecordType) => string | undefined;
  viewport: HTMLDivElement | null;
  rowOffset: number;
}) => {
  const data = useDataTableDataContext() ?? [];
  const { hasBulkActions } = useDataTableConfigContext();
  const [focusedId, setFocusedId] = useState<Identifier | null>(null);
  const focused =
    focusedId === null
      ? -1
      : data.findIndex((record) => record.id === focusedId);
  const virtualizer = useVirtualizer({
    count: data.length,
    enabled: data.length > 20,
    getScrollElement: () => viewport,
    estimateSize: () => 40,
    getItemKey: (index) => data[index].id,
    overscan: 6,
    initialRect: { width: 800, height: 480 },
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          ...(focused >= 0 && focused < data.length ? [focused] : []),
        ]),
      ].sort((a, b) => a - b),
  });
  // Small pages already have a bounded DOM and need no scroll observer.
  if (data.length <= 20)
    return (
      <DataTableBody<RecordType>
        rowClassName={rowClassName}
        rowOffset={rowOffset}
      >
        {children}
      </DataTableBody>
    );
  const items = virtualizer.getVirtualItems();
  const cells = Children.count(children) + (hasBulkActions ? 1 : 0);
  // Native table rows retain column alignment and accessibility. Spacer rows
  // represent unmounted rows; measured heights support wrapped cell content.
  let end = 0;
  return (
    <TableBody>
      {items.map((item) => {
        const record = data[item.index];
        const gap = Math.max(0, item.start - end);
        end = item.end;
        return (
          <RecordContextProvider value={record} key={record.id}>
            {gap > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={cells}
                  style={{ height: gap, padding: 0, border: 0 }}
                />
              </tr>
            )}
            <DataTableRow
              tabIndex={0}
              ref={virtualizer.measureElement}
              data-index={item.index}
              aria-rowindex={rowOffset + item.index + 2}
              className={rowClassName?.(record)}
              onFocusCapture={() => setFocusedId(record.id)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node))
                  setFocusedId(null);
              }}
            >
              {children}
            </DataTableRow>
          </RecordContextProvider>
        );
      })}
      {virtualizer.getTotalSize() > end && (
        <tr aria-hidden="true">
          <td
            colSpan={cells}
            style={{
              height: virtualizer.getTotalSize() - end,
              padding: 0,
              border: 0,
            }}
          />
        </tr>
      )}
    </TableBody>
  );
};

const DataTableRow = ({
  children,
  className,
  ...rowProps
}: ComponentProps<"tr">) => {
  const { rowClick, handleToggleItem } = useDataTableCallbacksContext();
  const selectedIds = useDataTableSelectedIdsContext();
  const { hasBulkActions = false } = useDataTableConfigContext();

  const record = useRecordContext();
  if (!record) {
    throw new Error("DataTableRow can only be used within a RecordContext");
  }

  const resource = useResourceContext();
  if (!resource) {
    throw new Error("DataTableRow can only be used within a ResourceContext");
  }

  const navigate = useNavigate();
  const getPathForRecord = useGetPathForRecordCallback();

  const handleToggle = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!handleToggleItem) return;
      handleToggleItem(record.id, event);
    },
    [handleToggleItem, record.id],
  );

  const handleClick = useCallback(async () => {
    const temporaryLink =
      typeof rowClick === "function"
        ? rowClick(record.id, resource, record)
        : rowClick;

    const link = isPromise(temporaryLink) ? await temporaryLink : temporaryLink;

    const path = await getPathForRecord({
      record,
      resource,
      link,
    });
    if (path === false || path == null) {
      return;
    }
    navigate(path, {
      state: { _scrollToTop: true },
    });
  }, [record, resource, rowClick, navigate, getPathForRecord]);

  return (
    <TableRow
      {...rowProps}
      key={record.id}
      onClick={handleClick}
      onKeyDown={(event) => {
        rowProps.onKeyDown?.(event);
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          void handleClick();
        }
      }}
      className={cn(rowClick !== false && "cursor-pointer", className)}
    >
      {hasBulkActions ? (
        <TableCell className="flex w-8" onClick={handleToggle}>
          <Checkbox
            checked={selectedIds?.includes(record.id)}
            onClick={handleToggle}
          />
        </TableCell>
      ) : null}
      {children}
    </TableRow>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isPromise = (value: any): value is Promise<any> =>
  value && typeof value.then === "function";

const DataTableEmpty = () => {
  const translate = useTranslate();

  return (
    <Alert>
      <AlertDescription>
        {translate("ra.navigation.no_results", {
          name: "resultados",
          _: "No se encontraron resultados.",
        })}
      </AlertDescription>
    </Alert>
  );
};

export const DataTableLoading = ({
  hasBulkActions = false,
  className,
}: {
  hasBulkActions?: boolean;
  className?: string;
}) => (
  <div
    className={cn("rounded-md border bg-card overflow-hidden", className)}
    role="status"
    aria-label="Cargando datos…"
  >
    <Table>
      <TableHeader>
        <TableRow>
          {hasBulkActions ? (
            <TableHead className="w-8">
              <Skeleton className="size-4" />
            </TableHead>
          ) : null}
          {Array.from({ length: 4 }, (_, i) => (
            <TableHead key={i}>
              <Skeleton className="h-4 w-24 my-2" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 5 }, (_, rowIndex) => (
          <TableRow key={rowIndex}>
            {hasBulkActions ? (
              <TableCell className="w-8">
                <Skeleton className="size-4" />
              </TableCell>
            ) : null}
            {Array.from({ length: 4 }, (_, colIndex) => (
              <TableCell key={colIndex} className="py-3.5">
                <Skeleton
                  className={cn(
                    "h-4",
                    colIndex === 0
                      ? "w-20"
                      : colIndex === 1
                        ? "w-40"
                        : colIndex === 2
                          ? "w-28"
                          : "w-24",
                  )}
                />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
);

export interface DataTableProps<
  RecordType extends RaRecord = RaRecord,
> extends Partial<DataTableBaseProps<RecordType>> {
  children: ReactNode;
  className?: string;
  rowClassName?: (record: RecordType) => string | undefined;
  bulkActionButtons?: ReactNode;
  bulkActionsToolbar?: ReactNode;
  scrollViewportRef?: Ref<HTMLDivElement>;
  /** Mount only visible rows in a bounded scroll viewport. */
  virtualize?: boolean;
  rowOffset?: number;
}

export function DataTableColumn<
  RecordType extends RaRecord<Identifier> = RaRecord<Identifier>,
>(props: DataTableColumnProps<RecordType>) {
  const renderContext = useDataTableRenderContext();
  switch (renderContext) {
    case "columnsSelector":
      return <ColumnsSelectorItem<RecordType> {...props} />;
    case "header":
      return <DataTableHeadCell {...props} />;
    case "data":
      return <DataTableCell {...props} />;
  }
}

/**
 * Reorder children based on columnRanks
 *
 * Note that columnRanks may be shorter than the number of children
 */
const reorderChildren = (children: ReactNode, columnRanks: number[]) =>
  Children.toArray(children).reduce((acc: ReactNode[], child, index) => {
    const rank = columnRanks.indexOf(index);
    if (rank === -1) {
      // if the column is not in columnRanks, keep it at the same index
      acc[index] = child;
    } else {
      // if the column is in columnRanks, move it to the rank index
      acc[rank] = child;
    }
    return acc;
  }, []);

function DataTableHeadCell<
  RecordType extends RaRecord<Identifier> = RaRecord<Identifier>,
>(props: DataTableColumnProps<RecordType>) {
  const {
    disableSort,
    source,
    label,
    sortByOrder,
    className,
    headerClassName,
  } = props;

  const sort = useDataTableSortContext();
  const { handleSort } = useDataTableCallbacksContext();
  const resource = useResourceContext();
  const translate = useTranslate();
  const translateLabel = useTranslateLabel();
  const { storeKey, defaultHiddenColumns } = useDataTableStoreContext();
  const [hiddenColumns] = useStore<string[]>(storeKey, defaultHiddenColumns);
  const isColumnHidden = hiddenColumns.includes(source!);
  if (isColumnHidden) return null;

  const nextSortOrder =
    sort && sort.field === source
      ? oppositeOrder[sort.order]
      : (sortByOrder ?? "ASC");
  const fieldLabel = translateLabel({
    label: typeof label === "string" ? label : undefined,
    resource,
    source,
  });
  const sortLabel = translate("ra.sort.sort_by", {
    field: fieldLabel,
    field_lower_first:
      typeof fieldLabel === "string"
        ? fieldLabel.charAt(0).toLowerCase() + fieldLabel.slice(1)
        : undefined,
    order: translate(`ra.sort.${nextSortOrder}`),
    _: translate("ra.action.sort"),
  });

  return (
    <TableHead className={cn(className, headerClassName)}>
      {handleSort && sort && !disableSort && source ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="group -ml-3 -mr-3 h-8 data-[state=open]:bg-accent cursor-pointer"
                data-field={source}
                onClick={handleSort}
              >
                {headerClassName?.includes("text-right") ? null : (
                  <FieldTitle
                    label={label}
                    source={source}
                    resource={resource}
                  />
                )}
                {sort.field === source ? (
                  sort.order === "ASC" ? (
                    <ArrowDownAZ className="ml-2 h-6 w-6" />
                  ) : (
                    <ArrowUpZA className="ml-2 h-6 w-6" />
                  )
                ) : (
                  <ArrowUpDown
                    aria-hidden="true"
                    className="ml-2 h-3.5 w-3.5 opacity-35 transition-opacity group-hover:opacity-75"
                  />
                )}
                {headerClassName?.includes("text-right") ? (
                  <FieldTitle
                    label={label}
                    source={source}
                    resource={resource}
                  />
                ) : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{sortLabel}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <FieldTitle label={label} source={source} resource={resource} />
      )}
    </TableHead>
  );
}

const oppositeOrder: Record<SortPayload["order"], SortPayload["order"]> = {
  ASC: "DESC",
  DESC: "ASC",
};

function DataTableCell<
  RecordType extends RaRecord<Identifier> = RaRecord<Identifier>,
>(props: DataTableColumnProps<RecordType>) {
  const {
    children,
    render,
    field,
    source,
    className,
    cellClassName,
    conditionalClassName,
  } = props;

  const { storeKey, defaultHiddenColumns } = useDataTableStoreContext();
  const [hiddenColumns] = useStore<string[]>(storeKey, defaultHiddenColumns);
  const record = useRecordContext<RecordType>();
  const isColumnHidden = hiddenColumns.includes(source!);
  if (isColumnHidden) return null;
  if (!render && !field && !children && !source) {
    throw new Error(
      "DataTableColumn: Missing at least one of the following props: render, field, children, or source",
    );
  }

  return (
    <TableCell
      className={cn(
        "py-1",
        className,
        cellClassName,
        record && conditionalClassName?.(record),
      )}
    >
      {children ??
        (render
          ? record && render(record)
          : field
            ? createElement(field, { source })
            : get(record, source!))}
    </TableCell>
  );
}

export interface DataTableColumnProps<
  RecordType extends RaRecord<Identifier> = RaRecord<Identifier>,
> {
  width?: number;
  className?: string;
  cellClassName?: string;
  headerClassName?: string;
  conditionalClassName?: (record: RecordType) => string | false | undefined;
  children?: ReactNode;
  render?: (record: RecordType) => React.ReactNode;
  field?: React.ElementType;
  source?: NoInfer<HintedString<ExtractRecordPaths<RecordType>>>;
  label?: React.ReactNode;
  disableSort?: boolean;
  sortByOrder?: SortPayload["order"];
}

export function DataTableNumberColumn<
  RecordType extends RaRecord<Identifier> = RaRecord<Identifier>,
>(props: DataTableNumberColumnProps<RecordType>) {
  const {
    source,
    options,
    locales,
    className,
    headerClassName,
    cellClassName,
    ...rest
  } = props;
  return (
    <DataTableColumn
      source={source}
      {...rest}
      className={className}
      headerClassName={cn("text-right", headerClassName)}
      cellClassName={cn("text-right", cellClassName)}
    >
      <NumberField source={source} options={options} locales={locales} />
    </DataTableColumn>
  );
}

export interface DataTableNumberColumnProps<
  RecordType extends RaRecord<Identifier> = RaRecord<Identifier>,
> extends DataTableColumnProps<RecordType> {
  source: NoInfer<HintedString<ExtractRecordPaths<RecordType>>>;
  locales?: string | string[];
  options?: Intl.NumberFormatOptions;
}
