// HTTP side of monitoring. Imported only by src/app.
import { monitoringService } from "./monitoring.service";

export const monitoringController = {
  async view() {
    return { data: await monitoringService.view() };
  },
};
