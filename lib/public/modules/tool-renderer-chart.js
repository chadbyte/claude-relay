// Truthful fixed-geometry charts for declarative Capsule UI.

import { collectionView, valueAtPath } from './tool-ui-evaluator.js';

var SVG_NS = "http://www.w3.org/2000/svg";

function finiteNumber(value) {
  var number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positiveNumber(value, fallback) {
  var number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function chartData(state, bind, props, item) {
  var limit = Math.max(1, Math.min(50, Number(props.maxItems) || 50));
  var rows = collectionView(valueAtPath(state, bind, item), { pageSize: limit });
  return rows.map(function (row, index) {
    var category = props.categoryKey ? valueAtPath(row, props.categoryKey, null) : index + 1;
    return {
      label: String(category === undefined || category === null ? "Item " + (index + 1) : category).slice(0, 200),
      value: Math.max(0, finiteNumber(valueAtPath(row, props.valueKey, null))),
    };
  });
}

export function lineGeometry(data) {
  var max = data.reduce(function (result, entry) { return Math.max(result, entry.value); }, 0) || 1;
  return data.map(function (entry, index) {
    return {
      x: data.length === 1 ? 50 : index / (data.length - 1) * 100,
      y: 40 - entry.value / max * 38,
      label: entry.label,
      value: entry.value,
    };
  });
}

export function donutGeometry(data) {
  var limited = data.slice(0, 12);
  var total = limited.reduce(function (sum, entry) { return sum + entry.value; }, 0);
  var offset = 0;
  return limited.map(function (entry, index) {
    var percent = total > 0 ? entry.value / total * 100 : 0;
    var segment = { percent: percent, offset: offset, color: index % 8, label: entry.label, value: entry.value };
    offset += percent;
    return segment;
  });
}

function createSvg(className, viewBox) {
  var svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}

function appendAccessibleData(figure, data) {
  var list = document.createElement("ul");
  list.className = "tool-chart-data";
  for (var i = 0; i < data.length; i++) {
    var entry = document.createElement("li");
    entry.textContent = data[i].label + ": " + data[i].value;
    list.appendChild(entry);
  }
  figure.appendChild(list);
}

function renderBar(figure, data) {
  var svg = createSvg("tool-chart-svg tool-chart-bar", "0 0 100 50");
  var max = data.reduce(function (result, entry) { return Math.max(result, entry.value); }, 0) || 1;
  var width = data.length ? Math.max(1, 90 / data.length) : 1;
  for (var i = 0; i < data.length; i++) {
    var height = data[i].value / max * 46;
    var rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", "tool-chart-bar-mark");
    rect.setAttribute("x", String(5 + i * width));
    rect.setAttribute("y", String(48 - height));
    rect.setAttribute("width", String(Math.max(1, width - 2)));
    rect.setAttribute("height", String(height));
    svg.appendChild(rect);
  }
  figure.appendChild(svg);
}

function renderLine(figure, data) {
  var geometry = lineGeometry(data);
  var svg = createSvg("tool-chart-svg tool-chart-line", "0 0 100 40");
  if (geometry.length) {
    var polyline = document.createElementNS(SVG_NS, "polyline");
    polyline.setAttribute("class", "tool-chart-line-path");
    polyline.setAttribute("points", geometry.map(function (point) { return point.x.toFixed(2) + "," + point.y.toFixed(2); }).join(" "));
    svg.appendChild(polyline);
  }
  for (var i = 0; i < geometry.length; i++) {
    var point = document.createElementNS(SVG_NS, "circle");
    point.setAttribute("class", "tool-chart-line-point");
    point.setAttribute("cx", geometry[i].x.toFixed(2));
    point.setAttribute("cy", geometry[i].y.toFixed(2));
    point.setAttribute("r", "1.8");
    svg.appendChild(point);
  }
  figure.appendChild(svg);
}

function renderDonut(figure, data) {
  var segments = donutGeometry(data);
  var svg = createSvg("tool-chart-svg tool-chart-donut", "0 0 42 42");
  var track = document.createElementNS(SVG_NS, "circle");
  track.setAttribute("class", "tool-chart-donut-track");
  track.setAttribute("cx", "21"); track.setAttribute("cy", "21"); track.setAttribute("r", "15.9155");
  svg.appendChild(track);
  for (var i = 0; i < segments.length; i++) {
    if (segments[i].percent <= 0) continue;
    var circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("class", "tool-chart-donut-segment tool-chart-color-" + segments[i].color);
    circle.setAttribute("cx", "21"); circle.setAttribute("cy", "21"); circle.setAttribute("r", "15.9155");
    circle.setAttribute("stroke-dasharray", segments[i].percent.toFixed(4) + " " + (100 - segments[i].percent).toFixed(4));
    circle.setAttribute("stroke-dashoffset", String(-segments[i].offset.toFixed(4)));
    svg.appendChild(circle);
  }
  figure.appendChild(svg);
}

export function renderChartNode(node, props, context) {
  var figure = document.createElement("figure");
  figure.className = "tool-chart tool-chart--" + props.kind;
  figure.setAttribute("aria-label", String(props.label));
  var caption = document.createElement("figcaption");
  caption.textContent = String(props.label);
  figure.appendChild(caption);
  var data = chartData(context.state, node.bind, props, context.item);
  if (props.kind === "donut") data = data.slice(0, 12);
  if (props.kind === "metric") {
    var metric = document.createElement("strong");
    metric.className = "tool-chart-metric";
    metric.textContent = data.length ? String(data[0].value) : "0";
    figure.appendChild(metric);
  } else if (props.kind === "progress") {
    var maximum = positiveNumber(props.max, 1);
    var current = Math.min(maximum, data.length ? data[0].value : 0);
    var progress = document.createElement("progress");
    progress.className = "tool-chart-progress";
    progress.max = maximum;
    progress.value = current;
    progress.textContent = current + " of " + maximum;
    figure.appendChild(progress);
    data = [{ label: props.label, value: current }];
  } else if (props.kind === "line") renderLine(figure, data);
  else if (props.kind === "donut") renderDonut(figure, data);
  else renderBar(figure, data);
  appendAccessibleData(figure, data);
  return figure;
}
