"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { get, post } from "@/lib/api-client";
import { AlertTriangle, CheckCircle, Clock, XCircle } from "lucide-react";

interface Incident {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  assignedTo: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export function IncidentManagement() {
  const { t } = useI18n();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newIncident, setNewIncident] = useState({
    title: "",
    description: "",
    severity: "MEDIUM",
  });

  useEffect(() => {
    loadIncidents();
  }, []);

  async function loadIncidents() {
    setLoading(true);
    try {
      const response = await get<{ incidents: Incident[] }>("/api/incidents");
      setIncidents(response.incidents ?? []);
    } catch (error) {
      console.error("Failed to load incidents:", error);
    } finally {
      setLoading(false);
    }
  }

  async function createIncident() {
    try {
      await post("/api/incidents", newIncident);
      setShowCreate(false);
      setNewIncident({ title: "", description: "", severity: "MEDIUM" });
      await loadIncidents();
    } catch (error) {
      console.error("Failed to create incident:", error);
    }
  }

  async function resolveIncident(id: string) {
    try {
      await post(`/api/incidents/${id}/resolve`, {
        resolution: "Resolved by operator",
      });
      await loadIncidents();
    } catch (error) {
      console.error("Failed to resolve incident:", error);
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case "OPEN":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case "INVESTIGATING":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "RESOLVED":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      default:
        return <XCircle className="h-4 w-4 text-gray-500" />;
    }
  }

  function getSeverityBadge(severity: string) {
    switch (severity) {
      case "CRITICAL":
        return <Badge variant="destructive">{t("severity.critical")}</Badge>;
      case "HIGH":
        return <Badge variant="destructive">{t("severity.high")}</Badge>;
      case "MEDIUM":
        return <Badge variant="secondary">{t("severity.medium")}</Badge>;
      default:
        return <Badge variant="outline">{t("severity.low")}</Badge>;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("incidents.title")}</h2>
        <Button onClick={() => setShowCreate(!showCreate)}>
          {t("incidents.create")}
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle>{t("incidents.newIncident")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder={t("incidents.titlePlaceholder")}
              value={newIncident.title}
              onChange={(e) => setNewIncident({ ...newIncident, title: e.target.value })}
            />
            <Textarea
              placeholder={t("incidents.descriptionPlaceholder")}
              value={newIncident.description}
              onChange={(e) => setNewIncident({ ...newIncident, description: e.target.value })}
            />
            <div className="flex gap-2">
              <Button onClick={createIncident}>{t("incidents.create")}</Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("incidents.active")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">{t("common.loading")}</p>
          ) : incidents.length === 0 ? (
            <p className="text-muted-foreground">{t("incidents.noIncidents")}</p>
          ) : (
            <div className="space-y-2">
              {incidents.map((incident) => (
                <div
                  key={incident.id}
                  className="p-4 rounded-lg border border-border"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(incident.status)}
                      <span className="font-medium">{incident.title}</span>
                    </div>
                    {getSeverityBadge(incident.severity)}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {incident.description}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {t("incidents.created")}: {new Date(incident.createdAt).toLocaleDateString()}
                    </span>
                    {incident.status !== "RESOLVED" && incident.status !== "CLOSED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resolveIncident(incident.id)}
                      >
                        {t("incidents.resolve")}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
