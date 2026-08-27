import { JobSearchService } from "../../dist/index.js";

try {
  const service = new JobSearchService({ dataRoot: process.argv[2] });
  await service.openWorkspace({ name: process.argv[3] });
  service.close();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
