// Grade My Finance — blog post manifest
// One shared list of every post + its category, used by related-posts.js
// to automatically render 2-3 relevant "Related" links on every post
// without hand-curating links inside each individual HTML file.
//
// To add a new post in the future: add one line here with its slug,
// title, and category. That's the only place a new post needs to be
// registered for related-links purposes (separate from sitemap.xml and
// blog/index.html, which still need their own updates for a brand new post).
var GMF_BLOG_POSTS = [
  { slug:"good-debt-vs-bad-debt", title:"Good Debt vs Bad Debt: How to Tell the Difference", category:"Debt" },
  { slug:"negotiating-medical-debt", title:"How to Negotiate Medical Debt", category:"Debt" },
  { slug:"sinking-funds-explained", title:"Sinking Funds: The Fix for Irregular Expenses", category:"Budgeting" },
  { slug:"combine-finances-before-marriage", title:"Should Couples Combine Finances Before Marriage?", category:"Relationships" },
  { slug:"financial-checklist-after-layoff", title:"A Financial Checklist for the First Week After a Layoff", category:"Habits" },
  { slug:"saving-for-a-wedding", title:"Saving for a Wedding Without Going Into Debt", category:"Savings" },
  { slug:"financial-advisor-vs-diy", title:"Financial Advisor vs. DIY: How to Actually Decide", category:"Advice" },
  { slug:"tax-brackets-explained", title:"Tax Brackets Explained: Marginal vs. Effective Rate", category:"Taxes" },
  { slug:"catching-up-on-retirement", title:"Catching Up on Retirement in Your 40s and 50s", category:"Retirement" },
  { slug:"what-is-a-529-plan", title:"What Is a 529 Plan, and Is It Worth It?", category:"Investing" },
  { slug:"lease-vs-buy-a-car", title:"Lease vs. Buy a Car: The Real Financial Comparison", category:"Budgeting" },
  { slug:"maximize-your-hsa", title:"HSAs: How to Actually Maximize the Triple Tax Advantage", category:"Taxes" },
  { slug:"understanding-your-credit-report", title:"Understanding Your Credit Report (Not Just the Score)", category:"Credit" },
  { slug:"pay-off-mortgage-early", title:"Should You Pay Off Your Mortgage Early?", category:"Debt" },
  { slug:"pay-off-student-loans-faster", title:"How to Pay Off Student Loans Faster", category:"Debt" },
  { slug:"what-is-a-heloc", title:"What Is a HELOC and When Does It Make Sense?", category:"Housing" },
  { slug:"financial-goals-that-stick", title:"How to Set Financial Goals That Actually Stick", category:"Habits" },
  { slug:"lifestyle-inflation", title:"Lifestyle Inflation: Why a Raise Doesn't Always Make You Richer", category:"Habits" },
  { slug:"high-yield-savings-accounts", title:"High-Yield Savings Accounts: Is Switching Actually Worth It?", category:"Savings" },
  { slug:"understanding-your-paycheck", title:"Understanding Your Paycheck: Gross vs. Net, Deductions Explained", category:"Budgeting" },
  { slug:"budgeting-irregular-income", title:"How to Budget With Irregular Income (Freelance / Gig Work)", category:"Budgeting" },
  { slug:"good-debt-to-income-ratio", title:"What Is a Good Debt-to-Income Ratio?", category:"Debt" },
  { slug:"automate-your-finances", title:"How to Automate Your Finances (Pay Yourself First)", category:"Habits" },
  { slug:"compound-interest-explained", title:"Compound Interest, Explained Simply", category:"Investing" },
  { slug:"renting-vs-buying", title:"Renting vs. Buying: The Real Financial Comparison", category:"Housing" },
  { slug:"investing-with-100-dollars", title:"How to Start Investing With $100", category:"Investing" },
  { slug:"roth-vs-traditional-ira", title:"Roth IRA vs. Traditional IRA: Which Is Right for You?", category:"Investing" },
  { slug:"building-credit-from-scratch", title:"How to Build Credit From Scratch", category:"Credit" },
  { slug:"how-much-house-can-i-afford", title:"How Much House Can I Actually Afford?", category:"Housing" },
  { slug:"how-to-negotiate-a-raise", title:"How to Negotiate a Raise (Without It Feeling Awkward)", category:"Habits" },
  { slug:"debt-snowball-vs-avalanche", title:"Debt Snowball vs. Avalanche: Which Actually Gets You Out Faster?", category:"Debt" },
  { slug:"talking-to-partner-about-money", title:"How to Talk to Your Partner About Money", category:"Relationships" },
  { slug:"credit-score-for-loans", title:"What Credit Score Do You Need for a Mortgage or Car Loan?", category:"Credit" },
  { slug:"budgeting-tight-income", title:"How to Budget When Money Is Really Tight", category:"Budgeting" },
  { slug:"invest-or-pay-off-debt", title:"Should You Invest or Pay Off Debt First?", category:"Debt" },
  { slug:"how-much-saved-by-age", title:"How Much Should I Have Saved by 30, 40, or 50?", category:"Net Worth" },
  { slug:"net-worth-vs-income", title:"Net Worth vs Income: Why They're Not the Same Thing", category:"Net Worth" },
  { slug:"emergency-fund-from-zero", title:"How to Build an Emergency Fund From $0", category:"Savings" },
  { slug:"financial-health-5-minutes", title:"How to Check Your Financial Health in 5 Minutes", category:"Financial Grade" },
  { slug:"50-30-20-rule", title:"The 50/30/20 Rule Explained: A Simple Budget That Works", category:"Budgeting" },
  { slug:"emergency-fund", title:"Why an Emergency Fund Is Your Financial Safety Net", category:"Savings" },
  { slug:"retirement-by-age", title:"How Much Should You Be Saving for Retirement by Age?", category:"Retirement" },
  { slug:"do-you-need-life-insurance", title:"Do You Actually Need Life Insurance? A Simple Framework", category:"Insurance" },
  { slug:"rsus-company-stock-vesting", title:"RSUs and Company Stock: What to Do When It Vests", category:"Investing" },
  { slug:"negotiate-lower-credit-card-rate", title:"How to Negotiate a Lower Interest Rate on Your Credit Cards", category:"Debt" },
  { slug:"signs-you-need-a-financial-advisor", title:"5 Signs You're Ready to Work With a Financial Advisor", category:"Advice" },
  { slug:"what-does-my-financial-grade-mean", title:"What a \"B+\" Financial Grade Actually Means", category:"Financial Grade" },
  { slug:"numbers-that-predict-your-grade", title:"The 3 Numbers That Predict Your Financial Grade Before You Even Calculate It", category:"Financial Grade" },
  { slug:"loud-budgeting", title:"Loud Budgeting: Why More People Are Talking Openly About Money", category:"Money Mindset" },
  { slug:"buy-now-pay-later", title:"Buy Now, Pay Later: Convenient Tool or Debt in Disguise?", category:"Debt" },
  { slug:"is-your-bank-losing-you-money", title:"High-Yield Savings Accounts: Why Your Cash Might Be Losing Value", category:"Savings" },
  { slug:"side-hustle-income", title:"Do Side Hustles Actually Move Your Financial Grade?", category:"Income" },
  { slug:"soft-saving", title:"Soft Saving: The Trend Pushing Back Against Aggressive Budgeting", category:"Money Mindset" }
,
  { slug:"fdic-insurance-explained", title:"FDIC Insurance Explained: How Protected Is Your Money in the Bank?", category:"Savings" }
,
  { slug:"required-minimum-distributions-explained", title:"Required Minimum Distributions (RMDs): What They Are and When You Have to Take Them", category:"Retirement" }
,
  { slug:"what-to-do-with-a-financial-windfall", title:"What to Do With a Financial Windfall: Bonus, Tax Refund, or Inheritance", category:"Advice" }
,
  { slug:"estate-planning-basics-wills-beneficiaries", title:"Estate Planning Basics: The 4 Documents Everyone Needs (Not Just the Wealthy)", category:"Advice" }
,
  { slug:"do-you-need-disability-insurance", title:"Disability Insurance: The Coverage Most People Skip (and Shouldn't)", category:"Insurance" }
,
  { slug:"when-to-claim-social-security", title:"When to Claim Social Security: What Claiming Early or Late Actually Costs You", category:"Retirement" }
,
  { slug:"capital-gains-tax-explained", title:"Capital Gains Tax Explained: Short-Term vs. Long-Term (and Why the Difference Is Huge)", category:"Taxes" }
,
  { slug:"credit-utilization-ratio-explained", title:"Credit Utilization: The Single Number Quietly Controlling Your Credit Score", category:"Credit" }
,
  { slug:"flexible-spending-accounts-explained", title:"FSAs Explained: The Pre-Tax Benefit Most People Waste Every Year", category:"Taxes" }
,
  { slug:"quarterly-estimated-taxes-explained", title:"Quarterly Estimated Taxes: What Freelancers and Side Hustlers Actually Owe (and When)", category:"Taxes" }
,
  { slug:"401k-employer-match-free-money", title:"401(k) Employer Match: Are You Leaving Free Money on the Table?", category:"Retirement" }
,
  { slug:"cd-laddering-explained", title:"CD Laddering: How to Earn More on Your Cash Without Locking It All Up", category:"Savings" }
,
  { slug:"umbrella-insurance-explained", title:"Umbrella Insurance: The Cheap Policy Most People Forget to Buy", category:"Insurance" }
,
  { slug:"term-vs-whole-life-insurance", title:"Term vs. Whole Life Insurance: Which One Actually Makes Sense", category:"Insurance" }
,
  { slug:"credit-freeze-vs-credit-lock", title:"Credit Freeze vs. Credit Lock: Which One Actually Protects You?", category:"Credit" }
,
  { slug:"index-funds-vs-actively-managed-funds-fees", title:"Index Funds vs. Actively Managed Funds: What the Fees Actually Cost You", category:"Investing" }
,
  { slug:"portfolio-rebalancing-explained", title:"Portfolio Rebalancing: Why It Matters and How Often You Should Actually Do It", category:"Investing" }
,
  { slug:"tax-loss-harvesting-explained", title:"Tax-Loss Harvesting: How to Turn Investment Losses Into a Real Tax Break", category:"Investing" }
,
  { slug:"long-term-care-insurance-explained", title:"Long-Term Care Insurance: Do You Actually Need It, and When Should You Buy It?", category:"Insurance" }
,
  { slug:"when-does-refinancing-your-mortgage-make-sense", title:"Mortgage Refinancing: When It Actually Makes Sense (and When It Doesn't)", category:"Housing" }
,
  { slug:"how-to-remove-pmi", title:"Private Mortgage Insurance (PMI): How to Get Rid of It Sooner", category:"Housing" }
,
  { slug:"series-i-savings-bonds-explained", title:"Series I Savings Bonds: How They Work and When They're Worth Buying", category:"Savings" }
,
  { slug:"sep-ira-vs-solo-401k-self-employed", title:"SEP IRA vs. Solo 401(k): Which Retirement Plan Actually Wins for the Self-Employed?", category:"Retirement" }
,
  { slug:"do-you-need-an-annuity", title:"Annuities: Do You Actually Need One?", category:"Insurance" }
,
  { slug:"zero-based-budgeting-explained", title:"Zero-Based Budgeting: How to Give Every Dollar a Job", category:"Budgeting" }
,
  { slug:"balance-transfer-credit-cards-explained", title:"Balance Transfer Credit Cards: When They Actually Save You Money (and When They Don't)", category:"Debt" }
,
  { slug:"what-to-do-with-an-old-401k", title:"What to Do With an Old 401(k) When You Change Jobs", category:"Retirement" }
,
  { slug:"hdhp-vs-ppo-open-enrollment", title:"HDHP vs. PPO: How to Actually Pick a Health Insurance Plan During Open Enrollment", category:"Insurance" }
,
  { slug:"renters-insurance-is-it-worth-it", title:"Renters Insurance: Is It Actually Worth the Cost?", category:"Insurance" }
,
  { slug:"do-you-need-a-living-trust", title:"Living Trust vs. Will: Do You Actually Need a Trust?", category:"Advice" }
,
  { slug:"credit-card-rewards-are-they-worth-it", title:"Credit Card Rewards: Are They Actually Worth It, or Just Marketing?", category:"Credit" }
,
  { slug:"backdoor-roth-ira-explained", title:"Backdoor Roth IRA: How It Works and Who Should Actually Use One", category:"Investing" }
,
  { slug:"custodial-accounts-utma-ugma-explained", title:"Custodial Accounts (UTMA/UGMA): How They Work and What Nobody Tells You About the Kiddie Tax", category:"Investing" }
,
  { slug:"target-date-funds-explained", title:"Target-Date Funds: How They Work and Whether They're Right for Your 401(k)", category:"Retirement" }
,
  { slug:"medicare-enrollment-timing-and-costs", title:"Medicare Enrollment: What It Actually Costs and When You Need to Sign Up", category:"Retirement" }
,
  { slug:"how-much-car-insurance-coverage-do-you-need", title:"How Much Car Insurance Do You Actually Need?", category:"Insurance" }
,
  { slug:"mega-backdoor-roth-explained", title:"Mega Backdoor Roth: How to Save Way More Than the 401(k) Limit Allows", category:"Investing" }
,
  { slug:"gap-insurance-do-you-need-it", title:"Gap Insurance: Do You Actually Need It?", category:"Insurance" }
,
  { slug:"payday-loans-why-so-expensive-alternatives", title:"Payday Loans: Why They're So Expensive, and What to Do Instead", category:"Debt" }
,
  { slug:"pet-insurance-is-it-worth-it", title:"Pet Insurance: Is It Actually Worth the Monthly Cost?", category:"Insurance" }
,
  { slug:"cobra-health-insurance-after-layoff", title:"COBRA Health Insurance After a Layoff: What It Actually Costs and When to Use It", category:"Insurance" }
,
  { slug:"debt-settlement-companies-explained", title:"Debt Settlement Companies: How They Work and What They Really Cost You", category:"Debt" }
,
  { slug:"safe-withdrawal-rate-4-percent-rule-explained", title:"The 4% Rule Explained: How Much You Can Actually Withdraw in Retirement", category:"Retirement" }
];
