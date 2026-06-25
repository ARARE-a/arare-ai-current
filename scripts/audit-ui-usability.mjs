import { readFileSync } from "node:fs";

const screens = [
  { name: "Home", path: "src/app/page.tsx", active: "home" },
  { name: "Store", path: "src/app/store/page.tsx", active: "store" },
  { name: "Therapist", path: "src/app/therapist/page.tsx", active: "therapist" },
  { name: "Customer", path: "src/app/customer/page.tsx", active: "customer" },
  { name: "Chat", path: "src/app/chat/page.tsx", active: "chat" },
  { name: "Ops", path: "src/app/ops/page.tsx", active: "ops" },
  { name: "Phone AI", path: "src/app/phone-ai/page.tsx", active: "phone-ai" }
];

const shared = readFileSync("src/components/UsabilityChrome.tsx", "utf8");

function scoreScreen(screen) {
  const source = readFileSync(screen.path, "utf8");
  const checks = [
    {
      label: "shared role navigation",
      points: 14,
      pass: source.includes(`RoleNav active="${screen.active}"`) || source.includes(`RoleNav active=\"${screen.active}\"`)
    },
    {
      label: "intuitive action lane",
      points: 18,
      pass: source.includes("ScreenGuide") && source.includes("steps={[")
    },
    {
      label: "clear primary action",
      points: 12,
      pass: source.includes("primaryAction")
    },
    {
      label: "mobile bottom navigation",
      points: 12,
      pass: shared.includes("fixed inset-x-3 bottom-3") && shared.includes("overflow-x-auto")
    },
    {
      label: "mobile-safe page padding",
      points: 10,
      pass: source.includes("pb-28") || source.includes("md:pb-0")
    },
    {
      label: "touch-friendly controls",
      points: 8,
      pass: source.includes("min-h-11") || source.includes("min-h-12") || shared.includes("min-h-12")
    },
    {
      label: "responsive grids",
      points: 10,
      pass: !/className="[^"]*grid-cols-(3|4)[^"]*"/.test(source) || /sm:grid-cols|md:grid-cols|xl:grid-cols/.test(source)
    },
    {
      label: "no obvious mojibake",
      points: 10,
      pass: !/[�縺笆笨譁蜊謗邯]/.test(source)
    },
    {
      label: "short route to related screen",
      points: 6,
      pass: source.includes("secondaryAction") || source.includes("href=\"/ops\"") || source.includes("href=\"/store\"")
    }
  ];

  const score = checks.reduce((sum, check) => sum + (check.pass ? check.points : 0), 0);
  return {
    ...screen,
    score,
    pass: score >= 90,
    failed: checks.filter((check) => !check.pass).map((check) => check.label)
  };
}

const results = screens.map(scoreScreen);
const overall = results.every((result) => result.pass) ? "PASS" : "FAIL";

console.log(JSON.stringify({ overall, threshold: 90, results }, null, 2));
process.exit(overall === "PASS" ? 0 : 1);
