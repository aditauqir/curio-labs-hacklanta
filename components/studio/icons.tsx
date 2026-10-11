import {
  ArrowDown,
  ArrowBendDownRight,
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowUp,
  ArrowsOutCardinal,
  ArrowsClockwise,
  Copy,
  Crop,
  DownloadSimple,
  Drop,
  Eraser,
  Eye,
  EyeSlash,
  Export,
  Eyedropper,
  FilePlus,
  FloppyDisk,
  Hand,
  House,
  Lasso,
  Lock,
  LockOpen,
  MagicWand,
  MagnifyingGlass,
  Minus,
  Microphone,
  MicrophoneSlash,
  PaintBrush,
  PaintBucket,
  Palette,
  PaperPlaneTilt,
  Plus,
  RectangleDashed,
  Sidebar,
  SidebarSimple,
  Scissors,
  Stamp,
  SlidersHorizontal,
  Sparkle,
  SquaresFour,
  Stack,
  Stop,
  Shuffle,
  TextT,
  Trash,
  X,
} from "@phosphor-icons/react";

type IconProps = { className?: string };

const phosphorProps = {
  size: 16,
  weight: "regular" as const,
  "aria-hidden": true,
};

export function MicIcon({ className }: IconProps) {
  return <Microphone {...phosphorProps} className={className} />;
}

export function StopIcon({ className }: IconProps) {
  return <Stop {...phosphorProps} className={className} />;
}

export function MicOffIcon({ className }: IconProps) {
  return <MicrophoneSlash {...phosphorProps} className={className} />;
}

export function SendIcon({ className }: IconProps) {
  return <PaperPlaneTilt {...phosphorProps} className={className} />;
}

export function DownloadIcon({ className }: IconProps) {
  return <DownloadSimple {...phosphorProps} className={className} />;
}

export function ResetIcon({ className }: IconProps) {
  return <ArrowCounterClockwise {...phosphorProps} className={className} />;
}

export function ArrowUpIcon({ className }: IconProps) {
  return <ArrowUp {...phosphorProps} className={className} />;
}

export function ArrowDownIcon({ className }: IconProps) {
  return <ArrowDown {...phosphorProps} className={className} />;
}

export function ArrowBendDownRightIcon({ className }: IconProps) {
  return <ArrowBendDownRight {...phosphorProps} className={className} />;
}

export function RedoIcon({ className }: IconProps) {
  return <ArrowClockwise {...phosphorProps} className={className} />;
}

export function RestyleIcon({ className }: IconProps) {
  return <ArrowsClockwise {...phosphorProps} className={className} />;
}

export function ShuffleIcon({ className }: IconProps) {
  return <Shuffle {...phosphorProps} className={className} />;
}

export function ExportIcon({ className }: IconProps) {
  return <Export {...phosphorProps} className={className} />;
}

export function SaveIcon({ className }: IconProps) {
  return <FloppyDisk {...phosphorProps} className={className} />;
}

export function FilePlusIcon({ className }: IconProps) {
  return <FilePlus {...phosphorProps} className={className} />;
}

export function HomeIcon({ className }: IconProps) {
  return <House {...phosphorProps} className={className} />;
}

export function PanelLeftIcon({ className }: IconProps) {
  return <SidebarSimple {...phosphorProps} className={className} />;
}

export function PanelRightIcon({ className }: IconProps) {
  return <Sidebar {...phosphorProps} className={className} />;
}

export function SlidersIcon({ className }: IconProps) {
  return <SlidersHorizontal {...phosphorProps} className={className} />;
}

export function SparkleIcon({ className }: IconProps) {
  return <Sparkle {...phosphorProps} className={className} />;
}

export function GridIcon({ className }: IconProps) {
  return <SquaresFour {...phosphorProps} className={className} />;
}

export function MoveIcon({ className }: IconProps) {
  return <ArrowsOutCardinal {...phosphorProps} className={className} />;
}

export function RectangleSelectIcon({ className }: IconProps) {
  return <RectangleDashed {...phosphorProps} className={className} />;
}

export function LassoIcon({ className }: IconProps) {
  return <Lasso {...phosphorProps} className={className} />;
}

export function MagicWandIcon({ className }: IconProps) {
  return <MagicWand {...phosphorProps} className={className} />;
}

export function CropIcon({ className }: IconProps) {
  return <Crop {...phosphorProps} className={className} />;
}

export function PaintBrushIcon({ className }: IconProps) {
  return <PaintBrush {...phosphorProps} className={className} />;
}

export function EraserIcon({ className }: IconProps) {
  return <Eraser {...phosphorProps} className={className} />;
}

export function StampIcon({ className }: IconProps) {
  return <Stamp {...phosphorProps} className={className} />;
}

export function DropIcon({ className }: IconProps) {
  return <Drop {...phosphorProps} className={className} />;
}

export function PaintBucketIcon({ className }: IconProps) {
  return <PaintBucket {...phosphorProps} className={className} />;
}

export function PaletteIcon({ className }: IconProps) {
  return <Palette {...phosphorProps} className={className} />;
}

export function CopyIcon({ className }: IconProps) {
  return <Copy {...phosphorProps} className={className} />;
}

export function ScissorsIcon({ className }: IconProps) {
  return <Scissors {...phosphorProps} className={className} />;
}

export function TrashIcon({ className }: IconProps) {
  return <Trash {...phosphorProps} className={className} />;
}

export function EyedropperIcon({ className }: IconProps) {
  return <Eyedropper {...phosphorProps} className={className} />;
}

export function HandIcon({ className }: IconProps) {
  return <Hand {...phosphorProps} className={className} />;
}

export function ZoomIcon({ className }: IconProps) {
  return <MagnifyingGlass {...phosphorProps} className={className} />;
}

export function MinusIcon({ className }: IconProps) {
  return <Minus {...phosphorProps} className={className} />;
}

export function PlusIcon({ className }: IconProps) {
  return <Plus {...phosphorProps} className={className} />;
}

export function LayersIcon({ className }: IconProps) {
  return <Stack {...phosphorProps} className={className} />;
}

export function EyeIcon({ className }: IconProps) {
  return <Eye {...phosphorProps} className={className} />;
}

export function EyeOffIcon({ className }: IconProps) {
  return <EyeSlash {...phosphorProps} className={className} />;
}

export function LockIcon({ className }: IconProps) {
  return <Lock {...phosphorProps} className={className} />;
}

export function LockOpenIcon({ className }: IconProps) {
  return <LockOpen {...phosphorProps} className={className} />;
}

export function TextIcon({ className }: IconProps) {
  return <TextT {...phosphorProps} className={className} />;
}

export function CloseIcon({ className }: IconProps) {
  return <X {...phosphorProps} className={className} />;
}
