import { CTASection } from "@/components/CTASection";
import { FeaturesSection } from "@/components/FeaturesSection";
import { Footer } from "@/components/Footer";
import { HeroSection } from "@/components/HeroSection";
import { HowItWorksSection } from "@/components/HowItWorksSection";
import { UseCasesSection } from "@/components/UseCasesSection";
import { LandingChatDockLazy } from "@/components/LandingChatDockLazy";
import { ValuePropositionSection } from "@/components/ValuePropositionSection";
import {
  getLoginHref,
  getOpenAppHref,
  getSignupHref,
} from "@/lib/appLinks";
import { fetchLandingContent } from "@/lib/fetchLandingContent";
import { getServerUser } from "@/lib/getServerUser";

/** Server-render each request so crawlers and users get fresh help-api content. */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [{ content }, user] = await Promise.all([
    fetchLandingContent(),
    getServerUser(),
  ]);
  const isAuthenticated = Boolean(user);

  const signupHref = getSignupHref();
  const loginHref = getLoginHref();
  const openAppHref = getOpenAppHref();

  return (
    <>
      <main>
        <HeroSection
          headline={content.hero.headline}
          subhead={content.hero.subhead}
          ctaPrimaryLabel={content.hero.ctaPrimary}
          ctaSecondaryLabel={content.hero.ctaSecondary}
          signupHref={signupHref}
          loginHref={loginHref}
          openAppHref={openAppHref}
          isAuthenticated={isAuthenticated}
        />
        <ValuePropositionSection columns={content.value.columns} />
        <HowItWorksSection steps={content.howItWorks.steps} />
        <FeaturesSection items={content.features.items} />
        <UseCasesSection items={content.useCases.items} />
        <CTASection
          headline={content.cta.headline}
          subhead={content.cta.subhead}
          signupHref={signupHref}
        />
        <Footer />
      </main>
      <LandingChatDockLazy />
    </>
  );
}
