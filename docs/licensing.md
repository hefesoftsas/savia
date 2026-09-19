# Savia licensing

The controlling terms are in [LICENSE](../LICENSE). The required attribution
is in [NOTICE](../NOTICE). This guide is explanatory, not a separate license.

Savia uses a custom source-available license, not an OSI-approved open-source
license. The [Open Source Definition](https://opensource.org/osd) does not
permit restrictions on business use of this kind.

| Situation | Requirement |
| --- | --- |
| Company revenue at or below USD 20,000 in both the preceding and current calendar month | May exercise the community license rights, subject to all other terms. |
| Company revenue above USD 20,000 in either month | Request and obtain a written commercial license before use; a pending request is insufficient. |
| Redistribution of a modified version | Publish the complete corresponding source and changes under the same license, include the source URL, LICENSE, and NOTICE. |
| Internal modifications with no distribution | No source-publication duty; revenue and attribution duties still apply. |
| Hosted service without distributing copies | No publication duty from hosting alone; revenue and attribution duties still apply. |
| Customized branding | Keep the Savia name and required Hefesoft attribution visible. |

The revenue test concerns the company's total worldwide business revenue,
not its Savia revenue or profit. USD 20,000 exactly is within the threshold;
USD 20,000.01 exceeds it. LICENSE defines currency conversion and what happens
when the threshold is crossed. A contractor and its customer must each meet
the eligibility requirements for their respective use.

Required visible attribution:

> Savia — Desarrollado por Hefesoft SAS, Colombia.

The license requires persistent attribution in graphical interfaces, including
login/public pages, and appropriate identification for CLI and headless services.
Adding these legal terms does not implement or verify attribution in every
existing application screen. Release owners must verify the UI and packaging.

Request commercial terms from Hefesoft SAS through the official repository's
maintainer contact channel: https://github.com/hefesoftsas/savia. No commercial
price or dedicated licensing email has been specified. Do not post confidential
financial information publicly. A commercial agreement must explicitly state
any exception to the publication or attribution requirements.

## Review before release

This custom license is a proposed legal text and needs review by Colombian
legal counsel before publication or reliance. Confirm the licensor's exact
registered name and authority over covered contributions, and review revenue
measurement, remedies, and compatibility with incorporated third-party code.
The existing form-engine MIT notice must remain intact. Earlier grants and
third-party rights are not retroactively revoked by this license.

The root package uses `SEE LICENSE IN LICENSE` rather than claiming a standard
OSI/SPDX license. Distributions must include the license and notices; packages
published independently must carry the applicable files in their own artifact.
