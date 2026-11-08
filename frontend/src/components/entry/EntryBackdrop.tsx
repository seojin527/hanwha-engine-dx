import { EngineeringBackdrop } from "../shell/EngineeringBackdrop";

/** Existing engine line art, shared by the public role chooser and admin login. */
export function EntryBackdrop() {
  return <div aria-hidden="true" className="entry-engine-backdrop pointer-events-none fixed inset-0 overflow-hidden">
    <EngineeringBackdrop strength={1.25} shapes={false} />
    <img src={`${import.meta.env.BASE_URL}images/login-engine-lineart.png`} alt="" className="entry-engine-lineart absolute left-[-28vw] top-1/2 h-[90vh] w-auto max-w-none -translate-y-1/2 opacity-25 [filter:brightness(0.3)] [mask-image:linear-gradient(to_right,black_25%,transparent_85%)] sm:left-[-12vw] lg:left-0 lg:opacity-35" />
    <img src={`${import.meta.env.BASE_URL}images/login-engine-full-lineart.png`} alt="" className="entry-engine-overview absolute bottom-[5vh] right-[-6vw] hidden w-[38vw] max-w-xl opacity-25 [filter:brightness(0.3)] [mask-image:linear-gradient(to_left,black_55%,transparent_100%)] md:block" />
  </div>;
}
