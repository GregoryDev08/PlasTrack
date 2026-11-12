const DATA_URL = "./data_copernicus_sample.json";
const GALAPAGOS_CENTER = [-0.5, -90.5];
const MAP_ZOOM = 7;

const elements = {
  status: document.getElementById("dashboard-status"),
  totalPasses: document.getElementById("total-passes"),
  averageCloudCover: document.getElementById("average-cloud-cover"),
  criticalAlerts: document.getElementById("critical-alerts"),
  map: document.getElementById("map"),
  chart: document.getElementById("cloud-cover-chart"),
  filterButtons: [...document.querySelectorAll(".filter-button")],
};

const aptitudeColors = {
  "Óptima": "#238263",
  "Aceptable": "#4c8f76",
  "Marginal": "#d99a36",
  "Pobre": "#c85a4b",
};

let allRecords = [];
let filteredRecords = [];
let map;
let markerLayer;
let currentMarkers = [];
let chart;

function normalizeStatus(status) {
  return status
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function showStatus(message, state = "info") {
  elements.status.textContent = message;
  elements.status.dataset.state = state;
}

function clearStatus() {
  elements.status.textContent = "";
  delete elements.status.dataset.state;
}

function validateRecords(data) {
  if (!Array.isArray(data)) {
    throw new TypeError("El archivo JSON debe contener un array de registros.");
  }

  const validRecords = data.filter((record) => (
    record !== null
    && typeof record === "object"
    && typeof record.fecha === "string"
    && Number.isFinite(Date.parse(record.fecha))
    && Number.isFinite(record.latitud)
    && Number.isFinite(record.longitud)
    && Number.isFinite(record.nubosidad)
    && record.nubosidad >= 0
    && record.nubosidad <= 100
    && typeof record.aptitud === "string"
    && typeof record.kpi_acumulacion === "string"
  ));

  if (validRecords.length !== data.length) {
    console.warn(
      `PlasTrack: se omitieron ${data.length - validRecords.length} registros con datos inválidos.`,
    );
  }

  if (validRecords.length === 0) {
    throw new Error("No hay registros válidos para mostrar.");
  }

  return validRecords.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

async function loadRecords() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`No se pudo cargar ${DATA_URL} (HTTP ${response.status}).`);
    }

    return validateRecords(await response.json());
  } catch (error) {
    console.warn("PlasTrack: no fue posible cargar los datos satelitales.", error);
    throw error;
  }
}

function updateKpis(records) {
  const averageCloudCover = records.reduce(
    (total, record) => total + record.nubosidad,
    0,
  ) / (records.length || 1);
  const criticalAlerts = records.filter((record) => {
    const status = normalizeStatus(record.kpi_acumulacion);
    return status === "critico" || status === "alerta";
  }).length;

  elements.totalPasses.textContent = new Intl.NumberFormat("es-ES").format(records.length);
  elements.averageCloudCover.textContent = records.length
    ? new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(averageCloudCover)
    : "—";
  elements.criticalAlerts.textContent = new Intl.NumberFormat("es-ES").format(criticalAlerts);
}

function getMarkerColor(status) {
  const normalizedStatus = normalizeStatus(status);
  if (normalizedStatus === "critico") return "#d65b4c";
  if (normalizedStatus === "alerta" || normalizedStatus === "precaucion") return "#e7a33b";
  return "#26856c";
}

function createPopupContent(record) {
  const content = document.createElement("div");
  const title = document.createElement("div");
  const date = document.createElement("div");
  const cloudCover = document.createElement("div");
  const aptitude = document.createElement("div");
  const statusRow = document.createElement("div");
  const statusIndicator = document.createElement("span");
  const status = document.createElement("span");

  title.className = "popup-title";
  title.textContent = `Pasada #${record.id ?? "—"}`;
  date.textContent = `Fecha: ${record.fecha}`;
  cloudCover.textContent = `Nubosidad: ${record.nubosidad}%`;
  status.className = "popup-status";
  aptitude.textContent = `Aptitud del sensor: ${record.aptitud}`;
  statusRow.className = "popup-status-row";
  statusIndicator.className = "popup-status-indicator";
  statusIndicator.style.backgroundColor = getMarkerColor(record.kpi_acumulacion);
  status.textContent = record.kpi_acumulacion;

  statusRow.append(statusIndicator, status);
  content.append(title, date, cloudCover, aptitude, statusRow);
  return content;
}

function updateMarkers(records) {
  markerLayer.clearLayers();
  currentMarkers = records.map((record) => {
    const marker = L.circleMarker([record.latitud, record.longitud], {
      radius: 7,
      color: "#ffffff",
      weight: 2,
      fillColor: getMarkerColor(record.kpi_acumulacion),
      fillOpacity: 0.95,
    })
      .bindPopup(createPopupContent(record))
      .addTo(markerLayer);

    return marker;
  });
}

function initializeMap() {
  if (typeof L === "undefined") {
    throw new Error("Leaflet no está disponible. Comprueba la conexión al CDN.");
  }

  elements.map.replaceChildren();
  map = L.map(elements.map, {
    scrollWheelZoom: false,
  }).setView(GALAPAGOS_CENTER, MAP_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  updateMarkers(filteredRecords);
}

function updateChart(records) {
  chart.data.labels = records.map((record) => record.fecha);
  chart.data.datasets[0].data = records.map((record) => record.nubosidad);
  chart.data.datasets[0].records = records;
  chart.data.datasets[0].pointBackgroundColor = records.map(
    (record) => aptitudeColors[record.aptitud] ?? "#66827c",
  );
  chart.update();
}

function initializeChart() {
  if (typeof Chart === "undefined") {
    throw new Error("Chart.js no está disponible. Comprueba la conexión al CDN.");
  }

  const context = elements.chart.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, 360);
  gradient.addColorStop(0, "rgb(36 132 112 / 24%)");
  gradient.addColorStop(1, "rgb(36 132 112 / 0%)");

  chart = new Chart(context, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "Nubosidad",
        data: [],
        records: [],
        borderColor: "#248470",
        backgroundColor: gradient,
        pointBackgroundColor: [],
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHitRadius: 10,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.32,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index",
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `Nubosidad: ${context.parsed.y}%`;
            },
            afterLabel(context) {
              const record = context.dataset.records[context.dataIndex];
              return [
                `Aptitud: ${record.aptitud}`,
                `KPI de acumulación: ${record.kpi_acumulacion}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: "#718985",
            maxRotation: 45,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
          },
          border: {
            display: false,
          },
        },
        y: {
          beginAtZero: true,
          max: 100,
          title: {
            display: true,
            text: "Nubosidad (%)",
            color: "#718985",
            font: {
              size: 11,
            },
          },
          ticks: {
            color: "#718985",
            stepSize: 20,
            callback(value) {
              return `${value}%`;
            },
          },
          grid: {
            color: "rgb(105 135 128 / 12%)",
          },
          border: {
            display: false,
          },
        },
      },
      onClick(event, _activeElements, chartInstance) {
        const clickedPoints = chartInstance.getElementsAtEventForMode(
          event,
          "nearest",
          { intersect: true },
          false,
        );
        if (clickedPoints.length === 0) return;

        const index = clickedPoints[0].index;
        const record = filteredRecords[index];
        const marker = currentMarkers[index];
        if (!record || !marker || !map) return;

        map.flyTo([record.latitud, record.longitud], Math.max(map.getZoom(), 11), {
          animate: true,
          duration: 1.2,
        });
        marker.openPopup();
      },
    },
  });

  updateChart(filteredRecords);
  return chart;
}

function applyFilter(status) {
  filteredRecords = status === "todos"
    ? [...allRecords]
    : allRecords.filter((record) => normalizeStatus(record.kpi_acumulacion) === status);

  elements.filterButtons.forEach((button) => {
    const isActive = button.dataset.kpi === status;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  updateKpis(filteredRecords);
  updateMarkers(filteredRecords);
  updateChart(filteredRecords);
}

function initializeFilters() {
  elements.filterButtons.forEach((button) => {
    button.addEventListener("click", () => applyFilter(button.dataset.kpi));
  });
}

async function initializeDashboard() {
  try {
    allRecords = await loadRecords();
    filteredRecords = [...allRecords];
    initializeFilters();
    initializeMap();
    initializeChart();
    updateKpis(filteredRecords);
    clearStatus();
  } catch (error) {
    showStatus(
      `No se pudieron cargar las visualizaciones. ${error.message} Abre el sitio mediante un servidor web para permitir fetch().`,
      "error",
    );
    console.error("PlasTrack: error al inicializar el dashboard.", error);
  }
}

document.addEventListener("DOMContentLoaded", initializeDashboard, { once: true });
