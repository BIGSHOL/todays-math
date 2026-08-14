import { z } from "zod";

export const TESTCHANGER_CONTRACT_VERSION = 1 as const;

const finiteNumber = z.number().finite();
const positiveNumber = finiteNumber.positive();
const Vec2Schema = z.tuple([finiteNumber, finiteNumber]);
const Vec3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const DashSchema = z.array(positiveNumber).min(1).max(8);

const ViewProjectionSchema = z
  .object({
    kind: z.literal("view"),
    depthRatio: finiteNumber.min(0).max(2).default(0.5),
    depthDeg: finiteNumber.min(-360).max(360).default(45),
    scale: positiveNumber.max(500),
    origin: Vec2Schema,
  })
  .strict();

const CameraProjectionSchema = z
  .object({
    kind: z.literal("camera"),
    elev: finiteNumber.gt(-90).lt(90),
    azim: finiteNumber.min(-360).max(360),
    scale: positiveNumber.max(500),
    origin: Vec2Schema,
  })
  .strict();

export const FigureProjectionSchema = z.discriminatedUnion("kind", [
  ViewProjectionSchema,
  CameraProjectionSchema,
]);

const LineElementSchema = z
  .object({
    kind: z.literal("line"),
    start: Vec2Schema,
    end: Vec2Schema,
    width: positiveNumber.max(20).default(2),
    dash: DashSchema.optional(),
  })
  .strict();

const CircleElementSchema = z
  .object({
    kind: z.literal("circle"),
    center: Vec2Schema,
    radius: positiveNumber.max(640),
    width: positiveNumber.max(20).default(2),
  })
  .strict();

const DotElementSchema = z
  .object({
    kind: z.literal("dot"),
    point: Vec2Schema,
    radius: positiveNumber.max(40).default(2.4),
  })
  .strict();

const LabelElementSchema = z
  .object({
    kind: z.literal("label"),
    point: Vec2Schema,
    text: z.string().min(1).max(200),
    fontSize: positiveNumber.max(80).default(15),
    anchor: z.enum(["start", "middle", "end"]).default("middle"),
    italic: z.boolean().default(false),
  })
  .strict();

const PolylineElementSchema = z
  .object({
    kind: z.literal("polyline"),
    points: z.array(Vec2Schema).min(2).max(256),
    width: positiveNumber.max(20).default(2),
    dash: DashSchema.optional(),
    close: z.boolean().default(false),
  })
  .strict();

const SolidPolylineElementSchema = z
  .object({
    kind: z.literal("solidPolyline"),
    points: z.array(Vec3Schema).min(2).max(256),
    projection: FigureProjectionSchema,
    width: positiveNumber.max(20).default(2),
    dash: DashSchema.optional(),
    close: z.boolean().default(false),
  })
  .strict();

export const FigureElementSchema = z.discriminatedUnion("kind", [
  LineElementSchema,
  CircleElementSchema,
  DotElementSchema,
  LabelElementSchema,
  PolylineElementSchema,
  SolidPolylineElementSchema,
]);

export const EngineHealthRequestSchema = z
  .object({
    contractVersion: z.literal(TESTCHANGER_CONTRACT_VERSION),
    operation: z.literal("health"),
  })
  .strict();

export const FigureRenderRequestSchema = z
  .object({
    contractVersion: z.literal(TESTCHANGER_CONTRACT_VERSION),
    operation: z.literal("figure.render"),
    width: z.number().int().min(1).max(640),
    height: z.number().int().min(1).max(640),
    elements: z.array(FigureElementSchema).min(1).max(256),
  })
  .strict()
  .refine(
    ({ width, height }) => Math.max(width / height, height / width) <= 20,
    "SVG viewBox 종횡비는 20:1 이하여야 합니다.",
  );

export const FigureQaFixturesRequestSchema = z
  .object({
    contractVersion: z.literal(TESTCHANGER_CONTRACT_VERSION),
    operation: z.literal("figure.qaFixtures"),
  })
  .strict();

export const FigureSecurityProbeRequestSchema = z
  .object({
    contractVersion: z.literal(TESTCHANGER_CONTRACT_VERSION),
    operation: z.literal("figure.securityProbe"),
  })
  .strict();

export const OcrValidateRequestSchema = z
  .object({
    contractVersion: z.literal(TESTCHANGER_CONTRACT_VERSION),
    operation: z.literal("ocr.validate"),
    result: z.record(z.string(), z.unknown()),
  })
  .strict();

export const OcrRecognizeRequestSchema = z
  .object({
    contractVersion: z.literal(TESTCHANGER_CONTRACT_VERSION),
    operation: z.literal("ocr.recognize"),
    imageBase64: z.string().min(1).max(28_000_000),
    mode: z.enum(["page", "crop"]),
    backend: z.enum(["claude", "gemini-pro", "gemini-flash"]),
    model: z.string().min(1).max(200).optional(),
  })
  .strict();

export const TestchangerEngineRequestSchema = z.discriminatedUnion(
  "operation",
  [
    EngineHealthRequestSchema,
    FigureRenderRequestSchema,
    FigureQaFixturesRequestSchema,
    FigureSecurityProbeRequestSchema,
    OcrValidateRequestSchema,
    OcrRecognizeRequestSchema,
  ],
);

export const EngineSuccessResponseSchema = z
  .object({
    contractVersion: z.literal(TESTCHANGER_CONTRACT_VERSION),
    ok: z.literal(true),
    operation: z.string(),
    result: z.unknown(),
  })
  .strict();

export const EngineErrorResponseSchema = z
  .object({
    contractVersion: z.literal(TESTCHANGER_CONTRACT_VERSION),
    ok: z.literal(false),
    operation: z.string().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .strict(),
  })
  .strict();

export const TestchangerEngineResponseSchema = z.union([
  EngineSuccessResponseSchema,
  EngineErrorResponseSchema,
]);

export type TestchangerEngineRequest = z.input<
  typeof TestchangerEngineRequestSchema
>;
export type TestchangerEngineResponse = z.infer<
  typeof TestchangerEngineResponseSchema
>;
