/**
 * BCI Data Collection - Intake Form Component
 * Collects participant information before starting the session.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { RACE_OPTIONS, SEX_OPTIONS, TRIAL_OPTIONS } from '../constants/colors';
import type { ParticipantInfo } from '../types/session';

// Form validation schema
const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  age: z.coerce.number().min(1, 'Age must be at least 1').max(120, 'Age must be at most 120'),
  sex: z.string().min(1, 'Please select an option'),
  gender: z.string().min(1, 'Gender is required'),
  race: z.string().min(1, 'Please select an option'),
  total_trials: z.coerce.number().min(1).max(200),
});

type FormData = z.infer<typeof formSchema>;

interface IntakeFormProps {
  onSubmit: (data: ParticipantInfo) => void;
}

export function IntakeForm({ onSubmit }: IntakeFormProps) {
  const [_isAnonymous, setIsAnonymous] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isValid },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      age: undefined,
      sex: '',
      gender: '',
      race: '',
      total_trials: 5,
    },
    mode: 'onChange',
  });

  const handleAnonymousClick = () => {
    setIsAnonymous(true);
    setValue('name', 'Anonymous', { shouldValidate: true });
  };

  const handleFormSubmit = (data: FormData) => {
    onSubmit(data as ParticipantInfo);
  };

  const selectClassName =
    'flex h-10 w-full rounded-md border border-gray-600 bg-gray-700 text-white px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

  const labelClassName = 'text-sm font-medium leading-none text-gray-200';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <div className="w-full max-w-md bg-gray-800 rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-center mb-2 text-white">BCI Data Collection</h1>
        <p className="text-gray-300 text-center mb-6">
          Please fill out the form below to begin your session.
        </p>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          {/* Name Field */}
          <div className="space-y-2">
            <Label htmlFor="name" className={labelClassName}>Name</Label>
            <div className="flex gap-2">
              <Input
                id="name"
                placeholder="Enter your name"
                {...register('name')}
                className={`bg-gray-700 border-gray-600 text-white placeholder:text-gray-400 ${errors.name ? 'border-red-500' : ''}`}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAnonymousClick}
                className="whitespace-nowrap border-gray-600 text-gray-200 hover:bg-gray-700"
              >
                Stay Anonymous
              </Button>
            </div>
            {errors.name && <p className="text-sm text-red-400">{errors.name.message}</p>}
          </div>

          {/* Age Field */}
          <div className="space-y-2">
            <Label htmlFor="age" className={labelClassName}>Age</Label>
            <Input
              id="age"
              type="number"
              placeholder="Enter your age"
              min={1}
              max={120}
              {...register('age')}
              className={`bg-gray-700 border-gray-600 text-white placeholder:text-gray-400 ${errors.age ? 'border-red-500' : ''}`}
            />
            {errors.age && <p className="text-sm text-red-400">{errors.age.message}</p>}
          </div>

          {/* Sex Field */}
          <div className="space-y-2">
            <Label htmlFor="sex" className={labelClassName}>Sex</Label>
            <select
              id="sex"
              {...register('sex')}
              className={`${selectClassName} ${errors.sex ? 'border-red-500' : ''}`}
            >
              <option value="">Select sex</option>
              {SEX_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {errors.sex && <p className="text-sm text-red-400">{errors.sex.message}</p>}
          </div>

          {/* Gender Field */}
          <div className="space-y-2">
            <Label htmlFor="gender" className={labelClassName}>Gender</Label>
            <Input
              id="gender"
              placeholder="Enter your gender identity"
              {...register('gender')}
              className={`bg-gray-700 border-gray-600 text-white placeholder:text-gray-400 ${errors.gender ? 'border-red-500' : ''}`}
            />
            {errors.gender && <p className="text-sm text-red-400">{errors.gender.message}</p>}
          </div>

          {/* Race Field */}
          <div className="space-y-2">
            <Label htmlFor="race" className={labelClassName}>Race</Label>
            <select
              id="race"
              {...register('race')}
              className={`${selectClassName} ${errors.race ? 'border-red-500' : ''}`}
            >
              <option value="">Select race</option>
              {RACE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {errors.race && <p className="text-sm text-red-400">{errors.race.message}</p>}
          </div>

          {/* Testing Duration Field */}
          <div className="space-y-2">
            <Label htmlFor="total_trials" className={labelClassName}>Testing Duration</Label>
            <select
              id="total_trials"
              {...register('total_trials')}
              className={selectClassName}
            >
              {TRIAL_OPTIONS.map((option) => (
                <option key={option.trials} value={option.trials}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Submit Button */}
          <Button type="submit" className="w-full mt-6 bg-green-600 hover:bg-green-700 text-white" size="lg" disabled={!isValid}>
            Continue to Session
          </Button>
        </form>
      </div>
    </div>
  );
}
