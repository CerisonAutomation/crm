"use client";

/**
 * n8n Workflow Management Interface
 * Provides comprehensive management of n8n workflows including:
 * - Viewing imported workflows from Citizen Lane
 * - Monitoring n8n executions
 * - Managing workflow activation/deactivation
 * - Testing workflows via n8n API
 * - Seeing workflow details and connections
 */
import { redactSensitiveData } from "@/lib/security";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api-client";
// Security utilities imported for redacting sensitive data
import {
  getN8nWorkflows,
  getN8nExecutions,
  getN8nWorkflowDetail,
  getN8nExecutionDetail,
  testN8nWorkflow,
  toggleN8nWorkflow,
} from "@/lib/tools/n8n-tools";
import {
  BrandLoader,
  Eyebrow,
  SectionTitle,
  StateBadge,
  StatusBadge,
  EmptyState,
  Spinner,
  SandboxChip,
} from "@/components/brand/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { LoadingBlock, ErrorBlock } from "@/components/brand/data-state";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Eye,
  FlaskConical,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";

// Types for n8n workflow management
type N8nWorkflowsRes = Awaited<ReturnType<typeof api.n8nWorkflows>>;
type N8nWorkflow = N8nWorkflowsRes["workflows"][number];
type N8nExecutionsRes = Awaited<ReturnType<typeof api.n8nExecutions>>;
type N8nExecution = N8nExecutionsRes["executions"][number];
type N8nExecutionDetail = Awaited<ReturnType<typeof api.n8nExecution>>["execution"];

// Helper functions
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM HH:mm"); } catch { return "—"; }
}

function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Check if user can manage n8n workflows (ADMIN only based on existing patterns)
function canManageN8n(role: string | null | undefined): boolean {
  return role === "ADMIN";
}

// Main component
export function N8nWorkflowManager() {
  const session = useApp((s) => s.session);
  const canManage = canManageN8n(session?.role);
  
  // State for workflows
  const [workflowsData, setWorkflowsData] = useState<N8nWorkflow[] | null>(null);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  
  // State for executions
  const [executionsData, setExecutionsData] = useState<N8nExecution[] | null>(null);
  const [executionsLoading, setExecutionsLoading] = useState(true);
  const [executionsError, setExecutionsError] = useState<string | null>(null);
  
  // State for selected workflow/execution
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [workflowDetail, setWorkflowDetail] = useState<any | null>(null);
  const [executionDetail, setExecutionDetail] = useState<N8nExecutionDetail | null>(null);
  
  // UI state
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [executionOpen, setExecutionOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testPayload, setTestPayload] = useState("{}");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);
  
  // Load workflows
  const loadWorkflows = useCallback(async () => {
    if (!canManage) return;
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    try {
      const workflows = await getN8nWorkflows();
      setWorkflowsData(workflows);
    } catch (e) {
      setWorkflowsError(e instanceof Error ? e.message : "Failed to load workflows");
    } finally {
      setWorkflowsLoading(false);
    }
  }, [canManage]);
  
  // Load executions
  const loadExecutions = useCallback(async () => {
    if (!canManage) return;
    setExecutionsLoading(true);
    setExecutionsError(null);
    try {
      const executions = await getN8nExecutions();
      setExecutionsData(executions);
    } catch (e) {
      setExecutionsError(e instanceof Error ? e.message : "Failed to load executions");
    } finally {
      setExecutionsLoading(false);
    }
  }, [canManage]);
  
  // Load workflow detail
  const loadWorkflowDetail = useCallback(async (workflowId: string) => {
    if (!canManage) return;
    try {
      const workflow = await getN8nWorkflowDetail(workflowId);
      setWorkflowDetail(workflow);
    } catch (e) {
      toast({ title: "Failed to load workflow detail", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  }, [canManage]);
  
  // Load execution detail
  const loadExecutionDetail = useCallback(async (executionId: string) => {
    if (!canManage) return;
    try {
      const execution = await getN8nExecutionDetail(executionId);
      setExecutionDetail(execution);
    } catch (e) {
      toast({ title: "Failed to load execution detail", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  }, [canManage]);
  
  // Test workflow
  const testWorkflow = useCallback(async (workflowId: string) => {
    if (!testPayload.trim()) {
      toast({ title: "Payload required", description: "Provide a JSON payload for testing", variant: "destructive" });
      return;
    }
    
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testN8nWorkflow(workflowId, JSON.parse(testPayload));
      setTestResult({ ok: true, output: result });
      toast({ title: "Test successful", description: "Workflow executed successfully" });
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "Unknown error" });
      toast({ title: "Test failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }, []);
  
  // Toggle workflow active state
  const toggleWorkflowActive = useCallback(async (workflowId: string, currentlyActive: boolean) => {
    try {
      await toggleN8nWorkflow(workflowId, !currentlyActive);
      await loadWorkflows();
      toast({ 
        title: !currentlyActive ? "Workflow activated" : "Workflow deactivated", 
        description: `Workflow ${currentlyActive ? "deactivated" : "activated"} successfully` 
      });
    } catch (e) {
      toast({ title: "Failed to toggle workflow", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  }, [loadWorkflows]);
  
  // Refresh data
  const refreshData = useCallback(() => {
    void loadWorkflows();
    void loadExecutions();
  }, [loadWorkflows, loadExecutions]);
  
  // Effects
  useEffect(() => {
    if (canManage) {
      void loadWorkflows();
      void loadExecutions();
    }
  }, [canManage, loadWorkflows, loadExecutions]);
  
  useEffect(() => {
    if (selectedWorkflowId) {
      void loadWorkflowDetail(selectedWorkflowId);
    } else {
      setWorkflowDetail(null);
    }
  }, [selectedWorkflowId, loadWorkflowDetail]);
  
  useEffect(() => {
    if (selectedExecutionId) {
      void loadExecutionDetail(selectedExecutionId);
    } else {
      setExecutionDetail(null);
    }
  }, [selectedExecutionId, loadExecutionDetail]);
  
  if (!canManage) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">
        <div className="mb-8">
          <Eyebrow>n8n Workflow Management</Eyebrow>
          <SectionTitle className="mt-1.5">Access Restricted</SectionTitle>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            n8n workflow management is restricted to administrators only.
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">
      <div className="mb-8">
        <Eyebrow>n8n Workflow Management</Eyebrow>
        <SectionTitle className="mt-1.5">Manage n8n workflows imported from Citizen Lane</SectionTitle>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Monitor, test, and manage workflows that are exported to and executed by your n8n instance.
        </p>
      </div>
      
      {/* Tabs for different views */}
      <Tabs defaultValue="workflows" className="mb-6">
        <TabsList className="mb-6">
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="executions">Executions</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>
        
        {/* Workflows tab */}
        <TabsContent value="workflows" className="space-y-4">
          {workflowsLoading ? (
            <LoadingBlock />
          ) : workflowsError ? (
            <ErrorBlock message={workflowsError} onRetry={loadWorkflows} />
          ) : workflowsData === null ? (
            <EmptyState title="No workflows found" hint="Click the export button in the Automation console to generate n8n workflows from Citizen Lane templates." />
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <Button onClick={() => setWorkflowOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Export New Workflows
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={refreshData}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Refresh
                  </Button>
                </div>
              </div>
              
              <div className="max-h-96 overflow-y-auto pr-1">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-20">Name</TableHead>
                      <TableHead className="w-20">Nodes</TableHead>
                      <TableHead className="w-20">Status</TableHead>
                      <TableHead className="w-20">Updated</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workflowsData.map((workflow) => (
                      <TableRow
                        key={workflow.id}
                        className={cn(
                          "cursor-pointer",
                          selectedWorkflowId === workflow.id && "bg-gold/5"
                        )}
                        onClick={() => {
                          setSelectedWorkflowId(selectedWorkflowId === workflow.id ? null : workflow.id);
                          setWorkflowOpen(true);
                        }}
                        aria-label={`Inspect workflow ${workflow.name}`}
                      >
                        <TableCell className="flex min-w-0 items-center gap-3">
                          <span className="font-editorial text-cobble-ink">{workflow.name}</span>
                        </TableCell>
                        <TableCell className="text-center text-sm font-mono text-cobble-ink">{workflow.nodeCount}</TableCell>
                        <TableCell>
                          <StateBadge state={workflow.active ? "active" : "inactive"} />
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">{fmtDate(workflow.updatedAt)}</TableCell>
                        <TableCell className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={(e) => {
                            e.stopPropagation();
                            void toggleWorkflowActive(workflow.id, workflow.active);
                          }}>
                            {workflow.active ? (
                              <Ban className="mr-1.5 h-3.5 w-3.5" />
                            ) : (
                              <Play className="mr-1.5 h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button variant="outline" size="sm" onClick={(e) => {
                            e.stopPropagation();
                            setSelectedWorkflowId(workflow.id);
                            setWorkflowOpen(true);
                          }}>
                            <Eye className="mr-1.5 h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={(e) => {
                            e.stopPropagation();
                            setTestOpen(true);
                            setSelectedWorkflowId(workflow.id);
                            setTestPayload("{}");
                          }}>
                            <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Test
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>
        
        {/* Executions tab */}
        <TabsContent value="executions" className="space-y-4">
          {executionsLoading ? (
            <LoadingBlock />
          ) : executionsError ? (
            <ErrorBlock message={executionsError} onRetry={loadExecutions} />
          ) : executionsData === null ? (
            <EmptyState title="No executions found" hint="Executions will appear here when workflows are triggered in your n8n instance." />
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <Button variant="outline" size="sm" onClick={refreshData}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Refresh
                </Button>
                </div>
              </div>
              
              <div className="max-h-96 overflow-y-auto pr-1">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-20">Workflow</TableHead>
                      <TableHead className="w-20">Status</TableHead>
                      <TableHead className="w-20">Started</TableHead>
                      <TableHead className="w-20">Finished</TableHead>
                      <TableHead className="w-20">Duration</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executionsData.map((execution) => (
                      <TableRow
                        key={execution.id}
                        className={cn(
                          "cursor-pointer",
                          selectedExecutionId === execution.id && "bg-gold/5"
                        )}
                        onClick={() => {
                          setSelectedExecutionId(selectedExecutionId === execution.id ? null : execution.id);
                          setExecutionOpen(true);
                        }}
                        aria-label={`Inspect execution ${execution.id}`}
                      >
                        <TableCell className="flex min-w-0 items-center gap-3">
                          <span className="text-sm text-cobble-ink">{execution.workflowName}</span>
                        </TableCell>
                        <TableCell>
                          <StateBadge state={execution.status.toLowerCase() as any} />
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">{fmtDate(execution.startedAt)}</TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">{fmtDate(execution.completedAt)}</TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {execution.startedAt && execution.completedAt
                            ? `${Math.floor((new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000)}s`
                            : "—"}
                        </TableCell>
                        <TableCell className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={(e) => {
                            e.stopPropagation();
                            setSelectedExecutionId(execution.id);
                            setExecutionOpen(true);
                          }}>
                            <Eye className="mr-1.5 h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>
        
        {/* Templates tab - shows available Citizen Lane templates that can be exported */}
        <TabsContent value="templates" className="space-y-4">
          <div className="flex items-center gap-2">
            <SandboxChip label="Templates are Citizen Lane workflows that can be exported to n8n" />
            <p className="text-xs text-muted-foreground">
              Use the Automation console to export these templates as n8n workflows.
            </p>
          </div>
          {/* This would typically come from the workflow templates API */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {/* Placeholder for template cards - in a real implementation, this would fetch from workflow templates API */}
            <div className="text-center py-8 text-muted-foreground">
              Template gallery would be populated from Citizen Lane workflow templates
            </div>
          </div>
        </TabsContent>
      </Tabs>
      
      {/* Workflow detail dialog */}
      <Dialog open={workflowOpen} onOpenChange={setWorkflowOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{workflowDetail ? workflowDetail.name : "Loading workflow..."}</DialogTitle>
            <DialogDescription>
              Detailed view of the n8n workflow including its structure, nodes, and connections.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!workflowDetail ? (
              <LoadingBlock label="Loading workflow detail..." />
            ) : (
              <>
                <div className="grid gap-6">
                  <div className="col-span-2">
                    <h3 className="mt-2 font-editorial text-lg text-cobble-ink">Workflow Information</h3>
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">Name:</span>
                        <span className="font-mono text-cobble-ink">{workflowDetail.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">ID:</span>
                        <span className="font-mono text-cobble-ink">{workflowDetail.id}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">Nodes:</span>
                        <span className="font-mono text-cobble-ink">{workflowDetail.nodes?.length || 0}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">Connections:</span>
                        <span className="font-mono text-cobble-ink">{Object.keys(workflowDetail.connections || {}).length}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">Active:</span>
                        <span className="font-mono text-cobble-ink">{workflowDetail.active ? "Yes" : "No"}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">Updated:</span>
                        <span className="font-mono text-cobble-ink">{fmtDate(workflowDetail.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className="mt-2 font-editorial text-lg text-cobble-ink">Workflow Structure</h3>
                    {workflowDetail.nodes && workflowDetail.nodes.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        {workflowDetail.nodes.map((node, index) => (
                          <div key={node.id} className="flex items-start gap-4 rounded-md border p-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gold/50 bg-gold/10 font-editorial text-sm text-amber-ink">
                              {(node.name?.charAt(0) || "N").toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-cobble-ink">{node.name}</span>
                                <Badge variant="outline" className="text-[10px]">{node.type?.split('.').pop() || "NODE"}</Badge>
                              </div>
                              {node.position && (
                                <p className="text-xs text-muted-foreground">Position: ({node.position[0]}, {node.position[1]})</p>
                              )}
                              {node.webhookId && (
                                <p className="text-xs text-muted-foreground">Webhook ID: {node.webhookId}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="No nodes found" />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkflowOpen(false)}>Close</Button>
            {workflowDetail && (
              <Button onClick={() => {
                setWorkflowOpen(false);
                setTestOpen(true);
                setTestPayload("{}");
              }}>
                <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Test Workflow
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Execution detail dialog */}
      <Dialog open={executionOpen} onOpenChange={setExecutionOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{executionDetail ? `Execution ${executionDetail.id}` : "Loading execution..."}</DialogTitle>
            <DialogDescription>
              Detailed view of the n8n execution including its status, timing, and results.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!executionDetail ? (
              <LoadingBlock label="Loading execution detail..." />
            ) : (
              <>
                <div className="grid gap-6">
                  <div className="col-span-2">
                    <h3 className="mt-2 font-editorial text-lg text-cobble-ink">Execution Information</h3>
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">ID:</span>
                        <span className="font-mono text-cobble-ink">{executionDetail.id}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">Workflow:</span>
                        <span className="font-mono text-cobble-ink">{executionDetail.workflowName}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">Status:</span>
                        <StateBadge state={executionDetail.status.toLowerCase() as any} />
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">Started:</span>
                        <span className="font-mono text-cobble-ink">{fmtDate(executionDetail.startedAt)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">Finished:</span>
                        <span className="font-mono text-cobble-ink">{fmtDate(executionDetail.completedAt)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">Duration:</span>
                        <span className="font-mono text-cobble-ink">
                          {executionDetail.startedAt && executionDetail.completedAt
                            ? `${Math.floor((new Date(executionDetail.completedAt).getTime() - new Date(executionDetail.startedAt).getTime()) / 1000)}s`
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className="mt-2 font-editorial text-lg text-cobble-ink">Execution Results</h3>
                    {executionDetail.output && (
                      <div className="mt-4">
                        <h4 className="mt-1 font-editorial text-lg text-cobble-ink">Output</h4>
                        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-iron-ink">
                          {JSON.stringify(executionDetail.output, null, 2)}
                        </pre>
                      </div>
                    )}
                    {executionDetail.error && (
                      <div className="mt-4 rounded-md border border-coral/50 bg-coral/5 px-4 py-3">
                        <h4 className="mt-1 font-editorial text-lg text-cobble-ink">Error</h4>
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Error Details</p>
                        <p className="break-words font-mono text-xs leading-relaxed text-danger-ink">{executionDetail.error}</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExecutionOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Test workflow dialog */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Test n8n Workflow</DialogTitle>
            <DialogDescription>
              Send a test payload to the workflow to verify its behavior.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="test-payload">Test Payload (JSON)</Label>
              <Textarea
                id="test-payload"
                value={testPayload}
                onChange={(e) => setTestPayload(e.target.value)}
                rows={8}
                className="font-mono text-xs"
                placeholder='{"key": "value"}'
              />
              <div className="mt-2 flex items-center gap-2">
                <span
                  id="test-payload-counter"
                  className={cn("text-[11px] tabular-nums", testPayload.length >= 1000 ? "text-danger-ink" : "text-muted-foreground")}
                >
                  {testPayload.length}/{testPayload.length >= 1000 ? "1000" : "∞"}
                </span>
                <span className="text-xs text-muted-foreground">characters</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>Cancel</Button>
            <Button
              disabled={testing || !testPayload.trim()}
              onClick={() => {
                void testWorkflow(selectedWorkflowId ?? "");
              }}
            >
              {testing ? (
                <>
                  <Spinner className="mr-2 h-3.5 w-3.5" />
                  Testing...
                </>
              ) : (
                <>
                  <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
                  Run Test
                </>
              )}
            </Button>
          </DialogFooter>
          {testResult && (
            <div className="mt-4">
              <Card
                className={cn(
                  "rounded-md border p-4",
                  testResult.ok ? "border-olive/50 bg-olive/5" : "border-coral/50 bg-coral/5"
                )}
              >
                {testResult.ok ? (
                  <>
                    <p className="flex items-center gap-2 text-sm font-medium text-olive-ink">
                      <CheckCircle2 className="h-4 w-4" /> Test Successful
                    </p>
                    <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-iron-ink">
                      {JSON.stringify(testResult.output, null, 2)}
                    </pre>
                  </>
                ) : (
                  <p className="text-sm text-danger-ink">{testResult.error}</p>
                )}
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}