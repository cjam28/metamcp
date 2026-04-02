"use client";

import {
  McpServer,
  McpServerErrorStatusEnum,
  McpServerTypeEnum,
} from "@repo/zod-types";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  RowSelectionState,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  Copy,
  Edit,
  Eye,
  FileText,
  MoreHorizontal,
  Search,
  SearchCode,
  Server,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EditMcpServer } from "@/components/edit-mcp-server";
import { McpServersListSkeleton } from "@/components/skeletons/mcp-servers-list-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc, vanillaTrpcClient } from "@/lib/trpc";

interface McpServersListProps {
  onRefresh?: () => void;
}

export function McpServersList({ onRefresh }: McpServersListProps) {
  const { t } = useTranslations();
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([
    {
      id: "created_at",
      desc: true,
    },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<McpServer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [serverToEdit, setServerToEdit] = useState<McpServer | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // Use tRPC query for data fetching
  const {
    data: serversResponse,
    error,
    isLoading,
    refetch,
  } = trpc.frontend.mcpServers.list.useQuery();

  // tRPC mutation for deleting server
  const deleteServerMutation = trpc.frontend.mcpServers.delete.useMutation({
    onSuccess: (result) => {
      // Check if the operation was actually successful
      if (result.success) {
        // Invalidate and refetch the server list
        utils.frontend.mcpServers.list.invalidate();
        setDeleteDialogOpen(false);
        setServerToDelete(null);
        toast.success(t("mcp-servers:list.deleteServerSuccess"));
      } else {
        // Handle business logic failures
        console.error("Delete failed:", result.message);
        toast.error(t("mcp-servers:list.deleteServerError"), {
          description:
            result.message || t("mcp-servers:list.deleteServerError"),
        });
      }
    },
    onError: (error) => {
      console.error("Error deleting server:", error);
      toast.error(t("mcp-servers:list.deleteServerError"), {
        description: error.message,
      });
    },
    onSettled: () => {
      setIsDeleting(false);
    },
  });

  const servers = serversResponse?.success ? serversResponse.data : [];

  // Handle delete server
  const handleDeleteServer = async (server: McpServer) => {
    setIsDeleting(true);
    deleteServerMutation.mutate({
      uuid: server.uuid,
    });
  };

  // Handle successful edit
  const handleEditSuccess = () => {
    // Invalidate and refetch the server list
    utils.frontend.mcpServers.list.invalidate();
    setEditDialogOpen(false);
    setServerToEdit(null);
  };

  // Handle bulk delete — deletes selected servers sequentially and reports
  // live progress via a persistent toast so the UI never appears frozen.
  const handleBulkDelete = async () => {
    const selectedRows = table.getSelectedRowModel().rows;
    const total = selectedRows.length;
    if (total === 0) return;

    setBulkDeleteDialogOpen(false);
    setIsBulkDeleting(true);

    const toastId = toast.loading(`Deleting 0 of ${total} server${total !== 1 ? "s" : ""}…`);

    let succeeded = 0;
    let failed = 0;

    for (const row of selectedRows) {
      try {
        await vanillaTrpcClient.frontend.mcpServers.delete.mutate({
          uuid: row.original.uuid,
        });
        succeeded++;
      } catch {
        failed++;
      }
      const done = succeeded + failed;
      toast.loading(
        `Deleting ${done} of ${total} server${total !== 1 ? "s" : ""}…`,
        { id: toastId },
      );
    }

    await utils.frontend.mcpServers.list.invalidate();
    setRowSelection({});
    setIsBulkDeleting(false);

    if (failed === 0) {
      toast.success(
        `Deleted ${succeeded} server${succeeded !== 1 ? "s" : ""}`,
        { id: toastId },
      );
    } else {
      toast.warning(
        `Deleted ${succeeded} of ${total}; ${failed} failed`,
        { id: toastId },
      );
    }
  };

  // Define columns for the data table
  const columns: ColumnDef<McpServer>[] = [
    {
      id: "select",
      size: 40,
      header: ({ table: t }) => (
        <Checkbox
          checked={
            t.getIsAllPageRowsSelected() ||
            (t.getIsSomePageRowsSelected() ? "indeterminate" : false)
          }
          onCheckedChange={(value) => t.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
          className="translate-y-[2px]"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          className="translate-y-[2px]"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
      enableGlobalFilter: false,
    },
    {
      accessorKey: "name",
      size: 200,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("common:name")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const server = row.original;
        return (
          <div className="space-y-1 px-3 py-2">
            <div
              className="font-medium cursor-pointer hover:bg-muted/50 hover:text-primary rounded px-2 py-1 -mx-2 -my-1 transition-colors"
              onClick={() => router.push(`/mcp-servers/${server.uuid}`)}
            >
              {server.name}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "type",
      size: 120,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("common:type")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const type = row.getValue("type") as string;
        return (
          <div className="px-3 py-2">
            <Badge variant="info">{type.toUpperCase()}</Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "error_status",
      size: 120,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("mcp-servers:list.errorStatus")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const errorStatus = row.getValue("error_status") as string;
        const hasError = errorStatus === McpServerErrorStatusEnum.Enum.ERROR;
        return (
          <div className="px-3 py-2">
            <Badge variant={hasError ? "destructive" : "success"}>
              {hasError
                ? t("mcp-servers:list.error")
                : t("mcp-servers:list.noError")}
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "user_id",
      size: 120,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("mcp-servers:list.ownership")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const server = row.original;
        const isPublic = server.user_id === null;
        return (
          <div className="px-3 py-2">
            <Badge variant={isPublic ? "success" : "neutral"}>
              {isPublic ? t("mcp-servers:public") : t("mcp-servers:private")}
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "details",
      header: t("mcp-servers:list.configuration"),
      cell: ({ row }) => {
        const server = row.original;
        const details = [];

        if (server.command) {
          details.push(
            t("mcp-servers:list.command", { command: server.command }),
          );
        }
        if (server.args.length > 0) {
          details.push(
            t("mcp-servers:list.args", { args: server.args.join(" ") }),
          );
        }
        if (server.url) {
          details.push(t("mcp-servers:list.url", { url: server.url }));
        }
        if (Object.keys(server.env).length > 0) {
          details.push(
            t("mcp-servers:list.envVars", {
              count: Object.keys(server.env).length,
            }),
          );
        }

        return (
          <div className="text-sm space-y-1 w-full">
            {details.map((detail, index) => (
              <div
                key={index}
                className="text-muted-foreground break-words whitespace-normal overflow-wrap-anywhere"
              >
                {detail}
              </div>
            ))}
          </div>
        );
      },
    },
    {
      accessorKey: "created_at",
      size: 180,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("mcp-servers:list.created")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = new Date(row.getValue("created_at"));
        return (
          <div className="text-sm text-muted-foreground px-3 py-2">
            {date.toLocaleDateString()} {date.toLocaleTimeString()}
          </div>
        );
      },
    },
    {
      id: "actions",
      size: 100,
      header: t("mcp-servers:list.actions"),
      cell: ({ row }) => {
        const server = row.original;

        const copyServerJson = () => {
          const config: Record<string, unknown> = {
            type: server.type,
          };

          if (server.description) {
            config.description = server.description;
          }

          if (server.type === McpServerTypeEnum.Enum.STDIO) {
            if (server.command) {
              config.command = server.command;
            }
            if (server.args && server.args.length > 0) {
              config.args = server.args;
            }
            if (server.env && Object.keys(server.env).length > 0) {
              config.env = server.env;
            }
          } else if (
            server.type === McpServerTypeEnum.Enum.SSE ||
            server.type === McpServerTypeEnum.Enum.STREAMABLE_HTTP
          ) {
            if (server.url) {
              config.url = server.url;
            }
            if (server.bearerToken) {
              config.bearerToken = server.bearerToken;
            }
            if (server.headers && Object.keys(server.headers).length > 0) {
              config.headers = server.headers;
            }
          }

          const exportFormat = {
            mcpServers: {
              [server.name]: config,
            },
          };

          const serverJson = JSON.stringify(exportFormat, null, 2);
          navigator.clipboard.writeText(serverJson);
        };

        const handleInspect = () => {
          router.push(
            `/mcp-inspector?server=${encodeURIComponent(server.uuid)}`,
          );
        };

        const handleViewDetails = () => {
          router.push(`/mcp-servers/${server.uuid}`);
        };

        const handleDeleteClick = () => {
          setServerToDelete(server);
          setDeleteDialogOpen(true);
        };

        const handleEditClick = () => {
          setServerToEdit(server);
          setEditDialogOpen(true);
        };

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => navigator.clipboard.writeText(server.uuid)}
              >
                <Copy className="mr-2 h-4 w-4" />
                {t("mcp-servers:list.copyServerUuid")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyServerJson}>
                <FileText className="mr-2 h-4 w-4" />
                {t("mcp-servers:list.copyServerJson")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleInspect}>
                <SearchCode className="mr-2 h-4 w-4" />
                {t("mcp-servers:list.inspect")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleViewDetails}>
                <Eye className="mr-2 h-4 w-4" />
                {t("mcp-servers:list.viewDetails")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleEditClick}>
                <Edit className="mr-2 h-4 w-4" />
                {t("mcp-servers:editServer")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600"
                onClick={handleDeleteClick}
              >
                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                {t("mcp-servers:deleteServer")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const table = useReactTable({
    data: servers,
    columns,
    onSortingChange: setSorting,
    onGlobalFilterChange: (value) => setGlobalFilter(value || ""),
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.uuid,
    state: {
      sorting,
      globalFilter,
      rowSelection,
    },
  });

  // Expose mutate function for parent component
  const handleRefresh = () => {
    refetch();
    onRefresh?.();
  };

  if (error) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <div className="flex flex-col items-center justify-center mx-auto max-w-md">
          <Server className="size-12 text-red-400" />
          <h3 className="mt-4 text-lg font-semibold">
            {t("mcp-servers:list.errorLoadingTitle")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {error.message || t("mcp-servers:list.errorLoadingDescription")}
          </p>
          <Button onClick={handleRefresh} className="mt-4" variant="outline">
            {t("mcp-servers:list.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <McpServersListSkeleton />;
  }

  if (servers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <div className="flex flex-col items-center justify-center mx-auto max-w-md">
          <Server className="size-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">
            {t("mcp-servers:list.noServersTitle")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("mcp-servers:list.noServersDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Edit Server Dialog */}
      <EditMcpServer
        server={serverToEdit}
        isOpen={editDialogOpen}
        onClose={() => {
          setEditDialogOpen(false);
          setServerToEdit(null);
        }}
        onSuccess={handleEditSuccess}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {Object.keys(rowSelection).length} server
              {Object.keys(rowSelection).length !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete all {Object.keys(rowSelection).length}{" "}
              selected server
              {Object.keys(rowSelection).length !== 1 ? "s" : ""}. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkDeleteDialogOpen(false)}
            >
              {t("common:cancel")}
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete}>
              Delete {Object.keys(rowSelection).length} server
              {Object.keys(rowSelection).length !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("mcp-servers:list.deleteConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("mcp-servers:list.deleteConfirmDescription", {
                name: serverToDelete?.name || "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setServerToDelete(null);
              }}
              disabled={isDeleting}
            >
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                serverToDelete && handleDeleteServer(serverToDelete)
              }
              disabled={isDeleting}
            >
              {isDeleting
                ? t("mcp-servers:list.deleting")
                : t("mcp-servers:deleteServer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("mcp-servers:list.searchPlaceholder")}
              value={globalFilter || ""}
              onChange={(event) => setGlobalFilter(event.target.value || "")}
              className="pl-8"
            />
          </div>

          {/* Bulk action bar — appears when one or more rows are selected */}
          {Object.keys(rowSelection).length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5">
              <span className="text-sm text-muted-foreground">
                {Object.keys(rowSelection).length} selected
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setBulkDeleteDialogOpen(true)}
                disabled={isBulkDeleting}
                className="h-7 text-xs"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete selected
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRowSelection({})}
                disabled={isBulkDeleting}
                className="h-7 text-xs text-muted-foreground"
              >
                Clear
              </Button>
            </div>
          )}
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead
                        key={header.id}
                        className={
                          header.column.id === "details"
                            ? "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-normal w-full [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
                            : undefined
                        }
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={
                          cell.column.id === "details"
                            ? "p-2 align-middle whitespace-normal w-full [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
                            : undefined
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    {t("mcp-servers:list.noResults")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-end space-x-2 py-4">
          <div className="text-sm text-muted-foreground">
            {t("mcp-servers:list.totalServers", {
              count: table.getFilteredRowModel().rows.length,
            })}
          </div>
        </div>
      </div>
    </>
  );
}
