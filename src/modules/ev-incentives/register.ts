import { registerRideCompletionHook } from "../rides/hooks";
import { applyEvBonusToRide } from "./engine";

registerRideCompletionHook(applyEvBonusToRide);
