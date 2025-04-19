"use client";

import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Map } from "immutable";
import { iso31662 } from "iso-3166";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import LegalCertificationModal from "@/app/onboarding/LegalCertificationModal";
import Input from "@/components/Input";
import RadioButtons from "@/components/RadioButtons";
import Select from "@/components/Select";
import Status from "@/components/Status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { BusinessType, TaxClassification } from "@/db/enums";
import { useCurrentUser } from "@/global";
import { countries } from "@/models/constants";
import { trpc } from "@/trpc/client";
import { getTinName } from "@/utils/legal";
import { request } from "@/utils/request";
import { settings_tax_path } from "@/utils/routes";
import { useOnChange } from "@/utils/useOnChange";
import SettingsLayout from "../Layout";

const dataSchema = z.object({
  birth_date: z.string().nullable(),
  business_name: z.string().nullable(),
  business_type: z.number().nullable(),
  tax_classification: z.number().nullable(),
  citizenship_country_code: z.string(),
  city: z.string(),
  country_code: z.string(),
  display_name: z.string(),
  business_entity: z.boolean(),
  is_foreign: z.boolean(),
  is_tax_information_confirmed: z.boolean(),
  legal_name: z.string(),
  signature: z.string(),
  state: z.string(),
  street_address: z.string(),
  tax_id: z.string().nullable(),
  tax_id_status: z.enum(["verified", "invalid"]).nullable(),
  zip_code: z.string(),
  contractor_for_companies: z.array(z.string()),
});
type Data = z.infer<typeof dataSchema>;

export default function TaxPage() {
  const user = useCurrentUser();

  const { data } = useSuspenseQuery({
    queryKey: ["settings-tax"],
    queryFn: async () => {
      const response = await request({ accept: "json", method: "GET", url: settings_tax_path(), assertOk: true });
      return dataSchema.parse(await response.json());
    },
  });

  const form = useForm<Data>({
    resolver: zodResolver(dataSchema),
    defaultValues: data,
  });

  const [formData, setFormData] = useState(data);
  const [errors, setErrors] = useState(Map<string, string>());
  const countryCodePrefix = `${formData.country_code}-`;
  const countrySubdivisions = iso31662.filter((entry) => entry.code.startsWith(countryCodePrefix));

  const [taxInfoChanged, setTaxInfoChanged] = useState(false);
  const [isTaxInfoConfirmed, setIsTaxInfoConfirmed] = useState(false);
  const [showCertificationModal, setShowCertificationModal] = useState(false);
  const [taxIdChanged, setTaxIdChanged] = useState(false);
  const [taxIdStatus, setTaxIdStatus] = useState<Data["tax_id_status"]>(null);
  const [maskTaxId, setMaskTaxId] = useState(true);
  Object.entries(formData).forEach(([key, value]) =>
    useOnChange(() => {
      setTaxInfoChanged(true);
      setErrors(errors.delete(key));
    }, [value]),
  );

  useEffect(() => {
    setFormData(data);
    setIsTaxInfoConfirmed(data.is_tax_information_confirmed);
    setTaxIdStatus(data.tax_id_status);
  }, [data, form]);

  const isForeign = useMemo(
    () => formData.citizenship_country_code !== "US" && formData.country_code !== "US",
    [formData.citizenship_country_code, formData.country_code],
  );

  const tinName = getTinName(formData.business_entity);
  const taxIdPlaceholder = !isForeign ? (formData.business_entity ? "XX-XXXXXXX" : "XXX-XX-XXXX") : undefined;
  const zipCodeLabel = formData.country_code === "US" ? "ZIP code" : "Postal code";
  const stateLabel = formData.country_code === "US" ? "State" : "Province";
  const countryOptions = [...countries].map(([value, label]) => ({ value, label }));

  const normalizedTaxId = (taxId: string | null) => {
    if (!taxId) return null;
    if (isForeign) return taxId.toUpperCase().replace(/[^A-Z0-9]/gu, "");
    return taxId.replace(/[^0-9]/gu, "");
  };

  const formatUSTaxId = (value: string) => {
    if (isForeign) return value;

    const digits = value.replace(/\D/gu, "");
    if (formData.business_entity) {
      return digits.replace(/^(\d{2})(\d{0,7})/u, (_, p1: string, p2: string) => (p2 ? `${p1}-${p2}` : p1));
    }
    return digits.replace(/^(\d{3})(\d{0,2})(\d{0,4})/u, (_, p1: string, p2: string, p3: string) => {
      if (p3) return `${p1}-${p2}-${p3}`;
      if (p2) return `${p1}-${p2}`;
      return p1;
    });
  };

  const handleSave = () => {
    const newErrors = errors.clear().withMutations((errors) => {
      if (!formData.tax_id) errors.set("tax_id", `Please add your ${isForeign ? "foreign tax ID" : tinName}.`);
      else if (!isForeign) {
        if (formData.tax_id.length !== 9) errors.set("tax_id", `Please check that your ${tinName} is 9 numbers long.`);
        else if (/^(\d)\1{8}$/u.test(formData.tax_id))
          errors.set("tax_id", `Your ${tinName} can't have all identical digits.`);
      }

      const labels = {
        street_address: "residential address",
        city: "city or town",
        zip_code: zipCodeLabel.toLowerCase(),
      };
      for (const field of ["street_address", "city", "zip_code"] as const) {
        if (!formData[field]) errors.set(field, `Please add your ${labels[field]}.`);
      }

      if (!formData.state && countrySubdivisions.length > 0)
        errors.set("state", `Please select a ${stateLabel.toLowerCase()}.`);
      if (formData.business_entity && !formData.business_name) {
        errors.set("business_name", "Please add your business legal name.");
      }

      if (!/\S+\s+\S+/u.test(formData.legal_name)) {
        errors.set("legal_name", "This doesn't look like a complete full name.");
      }

      // Only validate US ZIP code format for US addresses
      if (formData.country_code === "US" && !/(^\d{5}|\d{9}|\d{5}[- ]\d{4})$/u.test(formData.zip_code)) {
        errors.set("zip_code", "Please add a valid ZIP code (5 or 9 digits).");
      } else if (formData.country_code !== "US" && !/\d/u.test(formData.zip_code)) {
        errors.set("zip_code", "Please add a valid postal code (must contain at least one number).");
      }

      if (formData.business_entity && formData.business_type === null) {
        errors.set("business_type", "Please select a business type.");
      }

      if (formData.business_type === BusinessType.LLC && formData.tax_classification === null) {
        errors.set("tax_classification", "Please select a tax classification.");
      }
    });
    setErrors(newErrors);
    if (newErrors.size === 0) setShowCertificationModal(true);
  };

  const router = useRouter();
  const trpcUtils = trpc.useUtils();
  const updateTaxSettings = trpc.users.updateTaxSettings.useMutation();
  const saveMutation = useMutation({
    mutationFn: async (signature: string) => {
      const data = await updateTaxSettings.mutateAsync({
        data: { ...formData, tax_id: normalizedTaxId(formData.tax_id), signature },
      });

      setIsTaxInfoConfirmed(true);
      setTaxInfoChanged(false);
      if (taxIdChanged) setTaxIdStatus(null);
      setTaxIdChanged(false);
      setShowCertificationModal(false);
      if (data.documentId) {
        await trpcUtils.documents.list.invalidate();
        router.push(`/documents?sign=${data.documentId}`);
      }
    },
  });

  return (
    <SettingsLayout>
      <Form {...form}>
        <form className="grid gap-x-5 gap-y-3 md:grid-cols-[25%_1fr]" onSubmit={form.handleSubmit(handleSave)}>
          <hgroup>
            <h2 className="text-xl font-bold">Tax information</h2>
            <p className="text-gray-400">
              {`These details will be included in your ${user.roles.worker ? "invoices and " : ""}applicable tax forms.`}
            </p>
          </hgroup>
          <Card>
            <CardContent className="grid gap-4">
              {!isTaxInfoConfirmed && (
                <Alert variant="destructive">
                  <ExclamationTriangleIcon />
                  <AlertDescription>
                    Confirm your tax information to avoid delays on your payments or additional tax withholding.
                  </AlertDescription>
                </Alert>
              )}

              {formData.tax_id_status === "invalid" && (
                <Alert>
                  <InformationCircleIcon />
                  <AlertTitle>Review your tax information</AlertTitle>
                  <AlertDescription>
                    Since there's a mismatch between the legal name and {tinName} you provided and your government
                    records, please note that your payments could experience a tax withholding rate of 24%. If you think
                    this may be due to a typo or recent changes to your name or legal entity, please update your
                    information.
                  </AlertDescription>
                </Alert>
              )}

              <FormField
                control={form.control}
                name="legal_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full legal name (must match your ID)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter your full legal name"
                        invalid={errors.has("legal_name")}
                        help={errors.get("legal_name")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="citizenship_country_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country of citizenship</FormLabel>
                    <FormControl>
                      <Select {...field} options={countryOptions} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="business_entity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type of entity</FormLabel>
                    <FormControl>
                      <RadioButtons
                        value={field.value ? "business" : "individual"}
                        onChange={(value) => field.onChange(value === "business")}
                        options={[
                          { label: "Individual", value: "individual" },
                          { label: "Business", value: "business" },
                        ]}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {formData.business_entity ? (
                <div className="grid auto-cols-fr grid-flow-col items-start gap-3">
                  <FormField
                    control={form.control}
                    name="business_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Business legal name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Enter business legal name"
                            invalid={errors.has("business_name")}
                            help={errors.get("business_name")}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {!isForeign ? (
                    <>
                      <FormField
                        control={form.control}
                        name="business_type"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <FormControl>
                              <Select
                                {...field}
                                options={[
                                  { label: "C corporation", value: BusinessType.CCorporation.toString() },
                                  { label: "S corporation", value: BusinessType.SCorporation.toString() },
                                  { label: "Partnership", value: BusinessType.Partnership.toString() },
                                  { label: "LLC", value: BusinessType.LLC.toString() },
                                ]}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {formData.business_type === BusinessType.LLC && (
                        <FormField
                          control={form.control}
                          name="tax_classification"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Tax classification</FormLabel>
                              <FormControl>
                                <Select
                                  {...field}
                                  options={[
                                    { label: "C corporation", value: TaxClassification.CCorporation.toString() },
                                    { label: "S corporation", value: TaxClassification.SCorporation.toString() },
                                    { label: "Partnership", value: TaxClassification.Partnership.toString() },
                                  ]}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </>
                  ) : null}
                </div>
              ) : null}

              <FormField
                control={form.control}
                name="country_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{`Country of ${formData.business_entity ? "incorporation" : "residence"}`}</FormLabel>
                    <FormControl>
                      <Select {...field} options={countryOptions} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid items-start gap-3 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="tax_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <div className="flex justify-between gap-2">
                          {useMemo(() => (isForeign ? "Foreign tax ID" : `Tax ID (${tinName})`), [isForeign, tinName])}
                          {!isForeign && formData.tax_id && !taxIdChanged ? (
                            <>
                              {taxIdStatus === "verified" && <Status variant="success">VERIFIED</Status>}
                              {taxIdStatus === "invalid" && <Status variant="critical">INVALID</Status>}
                              {!taxIdStatus && <Status variant="primary">VERIFYING</Status>}
                            </>
                          ) : null}
                        </div>
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type={maskTaxId ? "password" : "text"}
                          onChange={(value) => {
                            field.onChange(normalizedTaxId(value));
                            setTaxIdChanged(true);
                          }}
                          suffix={
                            <Button
                              variant="link"
                              onPointerDown={() => setMaskTaxId(false)}
                              onPointerUp={() => setMaskTaxId(true)}
                              onPointerLeave={() => setMaskTaxId(true)}
                              onTouchStart={() => setMaskTaxId(false)}
                              onTouchEnd={() => setMaskTaxId(true)}
                              onTouchCancel={() => setMaskTaxId(true)}
                            >
                              {maskTaxId ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </Button>
                          }
                          placeholder={taxIdPlaceholder}
                          invalid={errors.has("tax_id")}
                          help={errors.get("tax_id")}
                          autoComplete="flexile-tax-id"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="birth_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{`Date of ${formData.business_entity ? "incorporation" : "birth"} (optional)`}</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="street_address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Residential address (street name, number, apartment)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter address"
                        invalid={errors.has("street_address")}
                        help={errors.get("street_address")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter city"
                        invalid={errors.has("city")}
                        help={errors.get("city")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid items-start gap-3 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{stateLabel}</FormLabel>
                      <FormControl>
                        <Select
                          {...field}
                          options={countrySubdivisions.map((entry) => ({
                            value: entry.code.slice(countryCodePrefix.length),
                            label: entry.name,
                          }))}
                          disabled={!countrySubdivisions.length}
                          invalid={errors.has("state")}
                          help={errors.get("state")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="zip_code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{zipCodeLabel}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={`Enter ${zipCodeLabel.toLowerCase()}`}
                          invalid={errors.has("zip_code")}
                          help={errors.get("zip_code")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>

            <CardFooter className="flex-wrap gap-4">
              <Button type="submit" disabled={!taxInfoChanged && isTaxInfoConfirmed}>
                Save changes
              </Button>

              {user.roles.worker ? (
                <div>
                  Changes to your tax information may trigger{" "}
                  {formData.contractor_for_companies.length === 1 ? "a new contract" : "new contracts"} with{" "}
                  {formData.contractor_for_companies.join(", ")}
                </div>
              ) : null}
            </CardFooter>
          </Card>
        </form>
      </Form>

      <LegalCertificationModal
        open={showCertificationModal}
        onClose={() => setShowCertificationModal(false)}
        legalName={formData.legal_name}
        isForeignUser={isForeign}
        isBusiness={formData.business_entity}
        mutation={saveMutation}
      />
    </SettingsLayout>
  );
}
