/**
 * Invoice PDF — port of pdf.py (layout matched to the approved demo).
 *
 *   * logo top-left, big bold INVOICE top-right
 *   * CUSTOMER DETAILS box (left) and VEHICLE DETAILS box (right)
 *   * DESCRIPTION OF WORK  | OPER No. | Time | LABOUR COST
 *   * PARTS DESCRIPTION    | QUANTITY | PART NUMBER | PARTS COST
 *   * SUBTOTAL / LABOUR COST / VAT @20% / TOTAL (right-aligned, ruled)
 *   * footer image at the bottom
 */
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import { INVOICE_PAGE_WIDTH_PT, MARGIN_PT } from "./constants";
import { footerDataUri, logoDataUri, pngSize } from "./assets";
import type { InvoiceRecord } from "../db/repo";
import { DEFAULT_VEHICLE_MAKE, VAT_RATE, money } from "../config";

const CONTENT_W = INVOICE_PAGE_WIDTH_PT - 2 * MARGIN_PT;

const styles = StyleSheet.create({
  page: {
    paddingTop: MARGIN_PT,
    paddingBottom: MARGIN_PT,
    paddingHorizontal: MARGIN_PT,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#000000",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  logo: { height: 46 },
  invoiceTitle: { fontFamily: "Helvetica-Bold", fontSize: 26 },
  detailsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  box: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#000000",
    paddingVertical: 5,
    paddingHorizontal: 7,
    minHeight: 106,
  },
  boxTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, marginBottom: 7 },
  fieldRow: { flexDirection: "row", marginBottom: 5 },
  fieldLabel: { fontFamily: "Helvetica-Bold", fontSize: 8 },
  fieldValue: { fontSize: 9 },
  section: { marginBottom: 14 },
  sectionHeaderRow: { flexDirection: "row", marginBottom: 4 },
  th: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    paddingBottom: 2,
    borderBottomWidth: 0.6,
    borderBottomColor: "#000000",
  },
  thRight: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    textAlign: "right",
    paddingBottom: 2,
    borderBottomWidth: 0.6,
    borderBottomColor: "#000000",
  },
  row: { flexDirection: "row", marginTop: 4 },
  td: { fontSize: 9 },
  tdRight: { fontSize: 9, textAlign: "right" },
  tdCenter: { fontSize: 9, textAlign: "center" },
  totals: { marginLeft: "auto", width: 230, marginBottom: 14 },
  totalRow: { flexDirection: "row", justifyContent: "flex-end" },
  totalLabel: { fontSize: 9.5, width: 120, textAlign: "right", paddingRight: 6 },
  totalLabelBold: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    width: 120,
    textAlign: "right",
    paddingRight: 6,
  },
  totalValue: {
    fontSize: 9.5,
    width: 100,
    textAlign: "right",
    borderBottomWidth: 0.7,
    borderBottomColor: "#000000",
    paddingBottom: 2,
  },
  totalValueBold: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    width: 100,
    textAlign: "right",
    borderBottomWidth: 1,
    borderBottomColor: "#000000",
    paddingBottom: 2,
  },
  footer: { width: CONTENT_W, marginTop: "auto" },
});
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function InvoiceDocument({ record }: { record: InvoiceRecord }) {
  const { invoice, customer, items, workItems } = record;
  const footer = pngSize("footer.png");
  const footerHeight = (CONTENT_W * footer.height) / footer.width;

  const labour = round2(
    workItems.reduce((a, w) => a + (Number(w.labourCost) || 0), 0),
  );
  const grand = Number(invoice.subtotal) || 0;
  const partsOnly = round2(grand - labour);
  const dateStr = formatDate(new Date());
  const invNo = `INV-${String(Math.trunc(invoice.invoiceNumber)).padStart(
    6,
    "0",
  )}`;

  return (
    <Document title={invNo}>
      <Page size="A4" style={styles.page}>
        {/* ---- header ---- */}
        <View style={styles.header}>
          {/* react-pdf <Image> is not an HTML <img>; alt does not apply. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image style={styles.logo} src={logoDataUri()} />
          <Text style={styles.invoiceTitle}>INVOICE</Text>
        </View>

        {/* ---- details ---- */}
        <View style={styles.detailsRow}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>CUSTOMER DETIALS</Text>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldValue}>{customer?.name ?? ""}</Text>
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>DATE: </Text>
              <Text style={styles.fieldValue}>{dateStr}</Text>
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>INVOICE NO: </Text>
              <Text style={styles.fieldValue}>{invNo}</Text>
            </View>
          </View>

          <View style={styles.box}>
            <Text style={styles.boxTitle}>VEHICLE DETAILS</Text>
            <VehicleRow
              label="MAKE"
              value={invoice.make || DEFAULT_VEHICLE_MAKE}
            />
            <VehicleRow label="MODEL" value={invoice.model ?? ""} />
            <VehicleRow label="REG" value={invoice.regNo ?? ""} />
            <VehicleRow label="MILEAGE" value={invoice.mileage ?? ""} />
          </View>
        </View>
{/* ---- description of work ---- */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.th, { flexGrow: 1, flexBasis: 0 }]}>
              DESCRIPTION OF WORK
            </Text>
            <Text style={[styles.th, { width: 95 }]}>OPER No.</Text>
            <Text style={[styles.th, { width: 70 }]}>Time</Text>
            <Text style={[styles.thRight, { width: 90 }]}>LABOUR COST</Text>
          </View>
          {workItems.map((w) => (
            <View key={w.id} style={styles.row}>
              <Text style={[styles.td, { flexGrow: 1, flexBasis: 0 }]}>
                {w.description ?? ""}
              </Text>
              <Text style={[styles.td, { width: 95 }]}>{w.operNo ?? ""}</Text>
              <Text style={[styles.td, { width: 70 }]}>
                {w.timeHours ?? ""}
              </Text>
              <Text style={[styles.tdRight, { width: 90 }]}>
                {money(Number(w.labourCost) || 0)}
              </Text>
            </View>
          ))}
        </View>

        {/* ---- parts ---- */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.th, { flexGrow: 1, flexBasis: 0 }]}>
              PARTS DESCRIPTION
            </Text>
            <Text style={[styles.th, { width: 70, textAlign: "center" }]}>
              QUANTITY
            </Text>
            <Text style={[styles.th, { width: 90 }]}>PART NUMBER</Text>
            <Text style={[styles.thRight, { width: 90 }]}>PARTS COST</Text>
          </View>
          {items.map((it) => (
            <View key={it.id} style={styles.row}>
              <Text style={[styles.td, { flexGrow: 1, flexBasis: 0 }]}>
                {it.designation || it.partNumber}
              </Text>
              <Text style={[styles.tdCenter, { width: 70 }]}>
                {it.quantity}
              </Text>
              <Text style={[styles.td, { width: 90 }]}>{it.partNumber}</Text>
              <Text style={[styles.tdRight, { width: 90 }]}>
                {money(Number(it.lineTotal) || 0)}
              </Text>
            </View>
          ))}
        </View>

        {/* ---- totals ---- */}
        <View style={styles.totals}>
          <TotalRow label="TOTAL" value={money(invoice.total)} bold />
          <TotalRow
            label={`VAT @ ${Math.round(VAT_RATE * 100)}%`}
            value={money(invoice.vat)}
          />
          <TotalRow label="LABOUR COST" value={money(labour)} />
          <TotalRow label="SUBTOTAL" value={money(partsOnly)} />
        </View>

        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image
          style={[styles.footer, { height: footerHeight }]}
          src={footerDataUri()}
        />
      </Page>
    </Document>
  );
}
function VehicleRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { width: 62 }]}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function TotalRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.totalRow}>
      <Text style={bold ? styles.totalLabelBold : styles.totalLabel}>
        {label}
      </Text>
      <Text style={bold ? styles.totalValueBold : styles.totalValue}>
        {value}
      </Text>
    </View>
  );
}

/** Render an invoice record to PDF bytes (port of generate_invoice_pdf). */
export async function renderInvoicePdf(record: InvoiceRecord): Promise<Buffer> {
  const buffer = await renderToBuffer(<InvoiceDocument record={record} />);
  return Buffer.from(buffer);
}